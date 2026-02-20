/**
 * SSE API Endpoint — processes chat messages through the agent loop.
 *
 * POST /api/chat/:sessionId
 * Body: { message: string }
 * Returns: SSE stream with agent thoughts, actions, screenshots
 *
 * Integrates Skill System: dynamically loads SKILL.md when agent uses use_skill.
 * Streams click coordinates for red dot overlay on canvas.
 */

import type { Route } from "./+types/api.chat";
import { getDb, schema } from "~/db/db.server";
import { eq } from "drizzle-orm";
import { browserManager } from "~/services/browser.server";
import { reason, type ChatMessage } from "~/services/agent.server";
import { createSSEStream } from "~/services/sse.server";
import { loadSkillInstructions, executeSkillValidation } from "~/services/skills.server";
import path from "node:path";

const MAX_ACTIONS = 8; // max autonomous actions before pausing

/** Generate a short title from the first user message */
function generateTitle(message: string): string {
  const urlMatch = message.match(/https?:\/\/([^/\s]+)/);
  const hostname = urlMatch ? urlMatch[1].replace(/^www\./, "") : "";

  // Strip URL from message to get the intent
  const intent = message
    .replace(/https?:\/\/[^\s]+/g, "")
    .trim()
    .replace(/^(navigate\s+to|go\s+to|open|test|check)\s+/i, "")
    .trim();

  if (hostname && intent) {
    const shortIntent = intent.length > 25 ? intent.slice(0, 25) + "…" : intent;
    return `${hostname} — ${shortIntent}`;
  }
  if (hostname) return hostname;
  return message.length > 40 ? message.slice(0, 40) + "…" : message;
}

export async function action({ request, params }: Route.ActionArgs) {
  const { sessionId } = params;
  const { message } = await request.json();
  const db = getDb();

  // Validate session
  const session = db.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId)).get();
  if (!session) {
    return new Response("Session not found", { status: 404 });
  }

  // Save user message
  db.insert(schema.messages)
    .values({ sessionId, role: "user", content: message })
    .run();

  // Auto-generate session title from first message
  if (!session.title || session.title === "New Chat") {
    const title = generateTitle(message);
    db.update(schema.sessions)
      .set({ title })
      .where(eq(schema.sessions.id, sessionId))
      .run();
  }

  // Get config from DB (with env fallback)
  const configRows = db.select().from(schema.config).all();
  const cfg: Record<string, string> = {};
  for (const row of configRows) cfg[row.key] = row.value;

  const provider = cfg.provider ?? "openai";
  const model = cfg.model ?? "";

  if (!model) {
    return new Response(
      JSON.stringify({ error: "No AI model configured. Please select a model in Settings." }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // Resolve API key: env var only
  let apiKey = "";
  if (provider === "openai") {
    apiKey = process.env.OPENAI_API_KEY ?? "";
  } else {
    // Default to OpenRouter for everything else (including legacy provider strings)
    apiKey = process.env.OPENROUTER_API_KEY ?? "";
  }

  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: `No API key configured for ${provider}. Please add it to your .env file.` }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  // Create SSE stream
  const { stream, send, close } = createSSEStream();

  // Process in background (don't block the response)
  const outputDir = path.join(process.cwd(), ".qaos", "screenshots", sessionId);

  (async () => {
    try {
      // Check if user message contains a URL to navigate to
      const urlMatch = message.match(/https?:\/\/[^\s]+/);
        if (urlMatch && !browserManager.hasSession(sessionId)) {
          send({ type: "thought", data: `Launching browser (${session.headless ? "Headless" : "Headed"}) and navigating to ${urlMatch[0]}...` });
          await browserManager.getPage(sessionId, urlMatch[0], session.headless ?? true);

        // Update session URL
        db.update(schema.sessions)
          .set({ url: urlMatch[0] })
          .where(eq(schema.sessions.id, sessionId))
          .run();
      }

      // Layer 3: Intent Classification (Router)
      // Only run this for the *latest* message if it's the one triggering this loop.
      // Since we process one message at a time in this endpoint (triggered by POST), we can classify `message`.
      const { classifyIntent } = await import("~/services/agent.server");
      const classification = await classifyIntent(apiKey, model, message, provider);
      
      if (classification.action === "refuse") {
         send({ type: "error", data: `Request Refused: ${classification.reasoning}` });
         db.insert(schema.messages)
            .values({ sessionId, role: "agent", content: `❌ Request Refused: ${classification.reasoning}` })
            .run();
         
         // Set status back to idle
         db.update(schema.sessions).set({ status: "idle" }).where(eq(schema.sessions.id, sessionId)).run();
         close();
         return;
      }
      
      if (classification.action === "use_skill") {
         send({ type: "thought", data: `Router suggested skill: ${classification.skill_name} (${classification.reasoning})` });
         // We could auto-inject the skill here, but the main agent loop will likely pick it up anyway 
         // since the system prompt sees the same skills. 
         // But the Router's value is 'Refusal' and providing a strong hint.
         // Let's rely on the main agent to pick it, but the classification ensures we did NOT refuse.
      } else {
         send({ type: "thought", data: `Router check passed: ${classification.reasoning}` });
      }

      // We removed the strict 'else if (!hasSession)' check here.
      // If no session exists, the agent loop will run. 
      // The agent will see "No active browser" in context and should decide to 'navigate' or 'ask_human'.

      // Build chat history from DB
      const dbMessages = db
        .select()
        .from(schema.messages)
        .where(eq(schema.messages.sessionId, sessionId))
        .all();

      const chatHistory: ChatMessage[] = dbMessages.map((m: { role: string; content: string }) => ({
        role: m.role as "user" | "agent" | "system",
        content: m.content,
      }));

      // Set status to running
      db.update(schema.sessions)
        .set({ status: "running" })
        .where(eq(schema.sessions.id, sessionId))
        .run();

      // Agent loop — multiple actions until done/ask_human or max reached
      let actionCount = 0;
      let agentFullText = "";
      let activeSkillContext: string | undefined;
      let activeSkillName: string | undefined;

      while (actionCount < MAX_ACTIONS) {
        // Check for stop signal
        const currentSession = db.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId)).get();
        // console.log(`[AgentLoop] Status check: ${currentSession?.status}`);
        if (currentSession?.status === "stopped") {
          console.log(`[AgentLoop] Stop signal received for ${sessionId}. Breaking loop.`);
          send({ type: "error", data: "Agent stopped by user." });
          agentFullText += "\n🛑 Agent stopped by user.";
          break;
        }
        // Capture screenshot (unless disabled)
        let screenshot: { base64: string; filePath: string } | null = null;
        if (process.env.DISABLE_SCREENSHOTS !== "true") {
          screenshot = await browserManager.captureScreenshot(
            sessionId,
            outputDir,
            `msg-${Date.now()}`
          );
        }

        if (screenshot) {
          send({ type: "screenshot", data: screenshot.base64 });
        }

        // Get DOM + errors
        const dom = await browserManager.getSimplifiedDOM(sessionId);
        const errors = browserManager.getConsoleErrors(sessionId);

        // Reason
        const agentAction = await reason(
          apiKey,
          model,
          chatHistory,
          screenshot?.base64 ?? "",
          dom,
          errors,
          provider,
          activeSkillContext
        );

        send({ type: "thought", data: agentAction.reasoning });
        agentFullText += (agentFullText ? "\n" : "") + agentAction.reasoning;

        // Check for stop signal again after potentially long reasoning
        const sessionAfterReason = db.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId)).get();
        if (sessionAfterReason?.status === "stopped") {
           console.log(`[AgentLoop] Stop signal received after reasoning. Breaking.`);
           send({ type: "error", data: "Agent stopped by user." });
           agentFullText += "\n🛑 Agent stopped by user.";
           break;
        }

        // Handle skill invocation
        if (agentAction.action === "use_skill") {
          if (activeSkillName === agentAction.skill_name) {
             send({ type: "thought", data: `⚠️ Skill '${agentAction.skill_name}' is already active. Preventing loop.` });
             chatHistory.push({ 
               role: "system", 
               content: `System: STOP! Skill '${agentAction.skill_name}' is ALREADY loaded and active. You are stuck in a loop. DO NOT call use_skill again. LOOK at the skill instructions in your context and execute the NEXT step (e.g., type_text into a field).` 
             });
             actionCount++;
             continue;
          }

          const skillInstructions = loadSkillInstructions(agentAction.skill_name);
          if (skillInstructions) {
             // Tripwire Layer: Execute Validation Script
             const validation = await executeSkillValidation(agentAction.skill_name);
             
             if (!validation.valid) {
               const errorMsg = validation.error 
                  ? `Skill '${agentAction.skill_name}' requires configuration: ${validation.error}. Please fix this to use the skill.`
                  : `Skill '${agentAction.skill_name}' validation failed. The environment or state does not meet the skill's strict requirements (Tripwire check).`;
               send({ type: "error", data: errorMsg });
               agentFullText += `\n❌ ${errorMsg}`;
               break; // Stop execution
             }

            activeSkillContext = skillInstructions;
            activeSkillName = agentAction.skill_name;
            send({ type: "thought", data: `📚 Loaded skill: ${agentAction.skill_name}` });
            agentFullText += `\n📚 Loaded skill: ${agentAction.skill_name}`;

            // Add skill context to chat history and mark it for clean-up
            chatHistory.push({
              role: "system",
              content: `[Skill: ${agentAction.skill_name}] ${skillInstructions}`,
              isSkillContext: true,
            });
          } else {
            send({ type: "error", data: `Skill not found: ${agentAction.skill_name}` });
            agentFullText += `\n❌ Skill not found: ${agentAction.skill_name}`;
          }
          actionCount++;
          continue; // re-reason with skill instructions loaded
        }

        // Handle action
        if (agentAction.action === "done") {
          send({ type: "done", data: agentAction.summary });
          agentFullText += `\n✅ ${agentAction.summary}`;
          // Clean context: remove skill instructions from history
          activeSkillContext = undefined;
          activeSkillName = undefined;
          break;
        }

        if (agentAction.action === "ask_human") {
          send({ type: "ask_human", data: agentAction.question });
          agentFullText += `\n❓ ${agentAction.question}`;
          break;
        }

        if (agentAction.action === "error") {
          send({ type: "error", data: agentAction.message });
          agentFullText += `\n❌ ${agentAction.message}`;
          break;
        }

        // Execute action — include coordinates for red dot overlay
        let actionLabel = "";
        let actionData = "";

        if (agentAction.action === "navigate") {
          actionLabel = `Navigating to ${agentAction.url}`;
          actionData = JSON.stringify({ label: actionLabel });
        } else if (agentAction.action === "click") {
          actionLabel = `Clicking at (${agentAction.x}, ${agentAction.y})`;
          actionData = JSON.stringify({ label: actionLabel, x: agentAction.x, y: agentAction.y });
        } else if (agentAction.action === "type") {
          actionLabel = `Typing "${agentAction.text}"`;
          actionData = JSON.stringify({ label: actionLabel, x: agentAction.x, y: agentAction.y });
        } else if (agentAction.action === "scroll") {
          actionLabel = `Scrolling ${agentAction.direction}`;
          actionData = JSON.stringify({ label: actionLabel });
        } else if (agentAction.action === "type_secret") {
          actionLabel = `Typing secret from env.${agentAction.key}`;
          actionData = JSON.stringify({ label: actionLabel, x: agentAction.x, y: agentAction.y });
        } else if (agentAction.action === "run_script") {
          actionLabel = `Running script: ${agentAction.skill_name}/${agentAction.script}`;
          actionData = JSON.stringify({ label: actionLabel });
        }

        send({ type: "action", data: actionData });
        agentFullText += `\n🎯 ${actionLabel}`;

        // Special handling for scripts and secrets
        if (agentAction.action === "run_script") {
             // Import dynamically to avoid circular deps if needed? No, logic is in skills.server
             // We need executeSkillScript
             const { executeSkillScript } = await import("~/services/skills.server");
             const result = await executeSkillScript(agentAction.skill_name, agentAction.script, agentAction.args);
             
             chatHistory.push({
               role: "system",
               content: `[Script Result] Output: ${JSON.stringify(result.output)} ${result.error ? `Error: ${result.error}` : ""}`
             });
             
             // Immediate loop to let agent use the result
             actionCount++;
             continue;
        }

        if (agentAction.action === "type_secret") {
           const secretValue = process.env[agentAction.key];
           if (!secretValue) {
             send({ type: "error", data: `Missing env var: ${agentAction.key}` });
             chatHistory.push({ role: "system", content: `Error: Environment variable ${agentAction.key} is not set.` });
             actionCount++;
             continue;
           }
           
           // We use the browserManager's executeAction but construct a synthetic "type" action
           // BUT executeAction takes a fixed schema. We need to cheat or update browserManager?
           // Actually browserManager.executeAction takes { action: string, text?: string ... }
           // So we can pass action="type" and text=secretValue
           await browserManager.executeAction(sessionId, {
             action: "type",
             x: agentAction.x,
             y: agentAction.y,
             text: secretValue 
           }, session?.headless ?? true);
        } else {
           // Normal actions
           await browserManager.executeAction(sessionId, {
             action: agentAction.action,
             x: (agentAction as any).x,
             y: (agentAction as any).y,
             text: (agentAction as any).text,
             direction: (agentAction as any).direction,
             url: (agentAction as any).url,
           }, session?.headless ?? true);
        }

        // Wait for page to settle
        await new Promise((r) => setTimeout(r, 1000));

        // Add this action to chat history for next reasoning step
        chatHistory.push({ role: "agent", content: `${agentAction.reasoning}\nAction: ${actionLabel}` });
        actionCount++;
      }

      // Take final screenshot
      let finalShot: { base64: string; filePath: string } | null = null;
      if (process.env.DISABLE_SCREENSHOTS !== "true") {
        finalShot = await browserManager.captureScreenshot(
          sessionId,
          outputDir,
          `final-${Date.now()}`
        );
      }
      if (finalShot) {
        send({ type: "screenshot", data: finalShot.base64 });
      }

      // Save agent message to DB
      db.insert(schema.messages)
        .values({
          sessionId,
          role: "agent",
          content: agentFullText,
          screenshotPath: finalShot?.filePath ?? null,
        })
        .run();
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      send({ type: "error", data: errorMsg });

      db.insert(schema.messages)
        .values({
          sessionId,
          role: "agent",
          content: `❌ Error: ${errorMsg}`,
        })
        .run();
    } finally {
      // Reset status to idle
      db.update(schema.sessions)
        .set({ status: "idle" })
        .where(eq(schema.sessions.id, sessionId))
        .run();
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
