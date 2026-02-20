/**
 * API: Replay a test case — execute recorded actions sequentially
 *
 * POST /api/replay
 * Body: { name, url, steps: [{ action, detail }], ... }
 * Returns: SSE stream with status updates and screenshots
 */

import type { Route } from "./+types/api.replay";
import { browserManager } from "~/services/browser.server";
import { createSSEStream } from "~/services/sse.server";
import { reason, type ChatMessage } from "~/services/agent.server";
import { loadSkillInstructions, executeSkillValidation } from "~/services/skills.server";
import path from "node:path";
import { getDb, schema } from "~/db/db.server";
import { eq } from "drizzle-orm";

const MAX_ACTIONS_PER_STEP = 10; // increased to allow complex steps like login

export async function action({ request }: Route.ActionArgs) {
  const testCase = await request.json();
  const { url, steps, mode } = testCase; // mode: "classic" | "test"

  if (!steps?.length) {
    return new Response(
      JSON.stringify({ error: "Test case must include steps" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const replayId = `replay-${Date.now()}`;
  const { stream, send, close } = createSSEStream();
  const outputDir = path.join(process.cwd(), ".qaos", "screenshots", replayId);
  const isHeadless = process.env.HEADLESS !== "false";
  const disableScreenshots = process.env.DISABLE_SCREENSHOTS === "true";

  (async () => {
    try {
      // Create a temporary session in DB so we can use the /api/stop endpoint
      try {
        getDb().insert(schema.sessions).values({
          id: replayId,
          title: testCase.name || "Replay",
          url: url || "",
          status: "running",
          createdAt: Math.floor(Date.now() / 1000),
          updatedAt: Math.floor(Date.now() / 1000),
        }).run();
      } catch (dbErr) {
        console.error("Failed to insert temp replay session", dbErr);
      }

      // Launch browser and navigate to URL
      if (url) {
        send({ type: "status" as "thought", data: `Launching browser → ${url}` });
      } else {
        send({ type: "status" as "thought", data: `Launching browser...` });
      }
      // Use headless by default for replay, or make it configurable?
      await browserManager.getPage(replayId, url, isHeadless);

      // Wait for page to load
      await new Promise((r) => setTimeout(r, 2000));

      // Capture initial screenshot
      if (!disableScreenshots) {
        const initial = await browserManager.captureScreenshot(replayId, outputDir, "initial");
        if (initial) {
          send({ type: "screenshot", data: initial.base64 });
        }
      }

      // ─── SMART REPLAY ───
      // Iterate through USER PROMPTS and let the Agent re-evaluate actions.
         
         // Mock chat history for the agent context
         const chatHistory: ChatMessage[] = [];
         
         for (let i = 0; i < steps.length; i++) {
           const step = steps[i];
           if (step.action !== "prompt") continue; // Should only have prompts in test mode
           
           const userInput = step.detail;
           send({ type: "step_start", data: i.toString() });
           send({ type: "thought", data: `▶️ Running Test Step ${i + 1}/${steps.length}: "${userInput}"` });
           
           // Add to history
           chatHistory.push({ role: "user", content: userInput });
           
           // Run Agent Loop for this step
           let actionCount = 0;
           let stepDone = false;
           let activeSkillContext: string | undefined;
           let activeSkillName: string | undefined;
           // We need an API key for the agent. In a real app, fetch from DB/Env.
           // For now, fetch provider/model from DB and keys from process.env.
           const configRows = getDb().select().from(schema.config).all();
           const cfg: Record<string, string> = {};
           for (const row of configRows) cfg[row.key] = row.value;

           const provider = cfg.provider ?? "openai";
           const model = cfg.model ?? "";

           let apiKey = "";
           if (provider === "openai") {
             apiKey = process.env.OPENAI_API_KEY ?? "";
           } else {
             apiKey = process.env.OPENROUTER_API_KEY ?? "";
           }
           
           if (!apiKey) {
             send({ type: "error", data: `Missing API Key for ${provider}. Please set OPENAI_API_KEY or OPENROUTER_API_KEY in .env` });
             break;
           }

           if (!model) {
             send({ type: "error", data: "Missing AI Model for Smart Replay. Please select a model in Settings." });
             break;
           }

           while (actionCount < MAX_ACTIONS_PER_STEP && !stepDone) {
             // 0. Check for stop signal
             const currentSession = getDb().select().from(schema.sessions).where(eq(schema.sessions.id, replayId)).get();
             if (currentSession?.status === "stopped") {
               send({ type: "error", data: "Replay stopped by user." });
               return; // Exit the entire replay async block
             }
             
             // 1. Snapshot
             let screenshotBase64 = "";
             if (!disableScreenshots) {
               const screenshot = await browserManager.captureScreenshot(replayId, outputDir, `step-${i}-${actionCount}`);
               if (screenshot) {
                 send({ type: "screenshot", data: screenshot.base64 });
                 screenshotBase64 = screenshot.base64;
               }
             }
             
             const dom = await browserManager.getSimplifiedDOM(replayId);
             const errors = browserManager.getConsoleErrors(replayId);
             
             // 2. Reason
             const agentAction = await reason(
                apiKey,
                model,
                chatHistory,
                screenshotBase64,
                dom,
                errors,
                provider, // Fetch provider dynamically
                activeSkillContext
             );
             
             send({ type: "thought", data: agentAction.reasoning });
             
             // 2.5 Check for stop again after long LLM reasoning
             const sessionAfterReason = getDb().select().from(schema.sessions).where(eq(schema.sessions.id, replayId)).get();
             if (sessionAfterReason?.status === "stopped") {
               send({ type: "error", data: "Replay stopped by user." });
               return; // Exit the entire replay async block
             }
             
             // 3. Act
             if (agentAction.action === "done") {
               send({ type: "step", data: `✓ Step Validated: ${agentAction.summary}` });
               chatHistory.push({ role: "agent", content: agentAction.summary });
               stepDone = true;
             } else if (agentAction.action === "ask_human") {
               send({ type: "step", data: `❓ Agent asked: ${agentAction.question}` });
               chatHistory.push({ role: "agent", content: agentAction.question });
               stepDone = true; // Stop this step, move to next (or fail?)
             } else if (agentAction.action === "error") {
               send({ type: "error", data: agentAction.message });
               stepDone = true;
             } else if (agentAction.action === "use_skill") {
                if (activeSkillName === agentAction.skill_name) {
                   send({ type: "thought", data: `⚠️ Skill '${agentAction.skill_name}' is already active. Preventing loop.` });
                   chatHistory.push({ 
                     role: "system", 
                     content: `System: STOP! Skill '${agentAction.skill_name}' is ALREADY loaded and active. You are stuck in a loop. DO NOT call use_skill again. LOOK at the skill instructions in your context and execute the NEXT step (e.g., type_text into a field).` 
                   });
                   actionCount++;
                   continue;
                }
             
                // Simplified skill injection for replay
                const skillInstructions = loadSkillInstructions(agentAction.skill_name);
                if (skillInstructions) {
                   const validation = await executeSkillValidation(agentAction.skill_name);
                   
                   if (validation.valid) {
                       activeSkillContext = skillInstructions;
                       activeSkillName = agentAction.skill_name;
                       chatHistory.push({ role: "system", content: `[Skill: ${agentAction.skill_name}] Loaded into context.`, isSkillContext: true } as any);
                       send({ type: "thought", data: `📚 Loaded skill: ${agentAction.skill_name}` });
                   } else {
                      const errorStr = validation.error
                          ? `Skill missing env vars: ${validation.error}`
                          : `Skill validation failed: ${agentAction.skill_name}`;
                      send({ type: "error", data: errorStr });
                      stepDone = true;
                   }
                } else {
                   send({ type: "error", data: `Skill not found: ${agentAction.skill_name}` });
                   stepDone = true;
                }
             } else if (agentAction.action === "run_script") {
                 const { executeSkillScript } = await import("~/services/skills.server");
                 const result = await executeSkillScript(agentAction.skill_name, agentAction.script, agentAction.args);
                 chatHistory.push({
                   role: "system",
                   content: `[Script Result] Output: ${JSON.stringify(result.output)} ${result.error ? `Error: ${result.error}` : ""}`
                 });
                 actionCount++;
                 continue;
                let actionLabel = agentAction.action;
                
             } else if (agentAction.action === "type_secret") {
                const secretValue = process.env[agentAction.key];
                if (!secretValue) {
                  send({ type: "error", data: `Missing env var: ${agentAction.key}` });
                  stepDone = true;
                  actionCount++;
                  continue;
                } else {
                  await browserManager.executeAction(replayId, {
                    action: "type",
                    x: agentAction.x,
                    y: agentAction.y,
                    text: secretValue 
                  }, isHeadless);
                  send({ type: "thought", data: `🎯 Typing secret from env.${agentAction.key}` });
                  
                  // Add execution history so agent knows it succeeded
                  chatHistory.push({
                    role: "system",
                    content: `[System] Successfully typed secret from env.${agentAction.key}`
                  });
                }
             } else {
               // Execute browser action
                let actionLabel = agentAction.action;
                
                await browserManager.executeAction(replayId, {
                  action: agentAction.action,
                  x: (agentAction as any).x,
                  y: (agentAction as any).y,
                  text: (agentAction as any).text,
                  direction: (agentAction as any).direction,
                  url: (agentAction as any).url,
                }, isHeadless); // headless
                
                send({ type: "thought", data: `🎯 Executed ${actionLabel}` });
                
                chatHistory.push({
                  role: "system",
                  content: `[System] Successfully executed: ${actionLabel}`
                });
             }

             // Wait for page to settle
             await new Promise((r) => setTimeout(r, 1000));

             // Add this action to chat history for next reasoning step
             const actionStr = agentAction.action === "type_secret" ? `type_secret (${agentAction.key})` : JSON.stringify(agentAction);
             chatHistory.push({ role: "agent", content: `${agentAction.reasoning}\nAction: ${actionStr}` });
             
             actionCount++;
           }
         }
          
          send({ type: "done", data: "Test Run Complete" });

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      send({ type: "error", data: msg });
    } finally {
      // Clean up replay browser session and DB
      try {
        getDb().delete(schema.sessions).where(eq(schema.sessions.id, replayId)).run();
      } catch (err) {
        // ignore cleanup error
      }
      await browserManager.closeSession(replayId);
      close();
    }
  })();

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
