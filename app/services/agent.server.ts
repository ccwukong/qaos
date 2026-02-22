/**
 * Agent Service — Multi-provider LLM reasoning loop (server-side)
 *
 * Uses Vercel AI SDK Core (streamText) with provider-specific model creators.
 * Supports OpenAI, OpenRouter, Anthropic, Google via provider routing.
 * Integrates the Skill System with progressive disclosure.
 */

import { generateText, tool } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import { z } from 'zod'
import { loadSkillMetadata, loadSkillInstructions, formatSkillSummary } from './skills.server'

// ─── Action Schema ──────────────────────────────────────────────────────────

import { ActionSchema, type AgentAction, getActionDescriptions } from './actions.schema'

// ─── Chat Message Type ──────────────────────────────────────────────────────

export interface ChatMessage {
  role: 'user' | 'agent' | 'system'
  content: string
  /** Flag indicating this message contains injected SKILL.md content */
  isSkillContext?: boolean
}

// ─── System Prompt ──────────────────────────────────────────────────────────

function buildSystemPrompt(skillContext?: string): string {
  const skillMetadata = loadSkillMetadata()
  const skillSummary = formatSkillSummary(skillMetadata)
  const actionDescriptions = getActionDescriptions()

  let prompt = `You are qaos, a conversational QA testing agent controlling a live web browser.

You are chatting with a developer who guides your testing. You maintain browser state across messages.

Your job:
1. Look at the screenshot and DOM to understand the current page state.
2. Decide the SINGLE next action based on the conversation and user's latest instruction.
3. Respond with ONLY a JSON object (no markdown, no explanation outside JSON).

Actions:
${actionDescriptions}

Rules:
- Use x,y pixel coordinates from the DOM snapshot or screenshot.
- One action per response. Target element centers.
- Use "ask_human" when you need clarification or encounter an unexpected state.
- Use "navigate" to go to a new URL.
- Generate realistic test data (dummy emails, names) when needed.
- "done" when the user's request is fully accomplished.
- Use "use_skill" when a situation matches an available skill's description. 
    - CRITICAL: If you see a "Log In", "Sign In", or "Sign Up" button, you MUST use the \`standard-login\` or \`standard-registration\` skill, UNLESS you are already executing that skill.
    - If the skill is ALREADY ACTIVE (check context), DO NOT call "use_skill" again for it. Execute the NEXT step in the skill instructions.
    - ALWAYS prefer using a skill over manual actions if a relevant skill exists.
- Use "type_secret" only for non-account secrets from .env. Do NOT use it for login username/password.
- For login credentials, ALWAYS use "type_test_account_secret" with field="username" or field="password" from the selected DB test account. Never output raw credential values.
- Use "run_script" to execute a skill's tool/script. args must match the tool definition.`

  if (skillSummary) {
    prompt += `\n\n${skillSummary}`
  }

  if (skillContext) {
    prompt += `\n\n## Active Skill Instructions\n${skillContext}`
  }

  return prompt
}

// ─── Model Factory ──────────────────────────────────────────────────────────

function getAiModel(provider: string, model: string, apiKey: string) {
  // Direct OpenAI/DeepSeek support via official SDK
  if (provider === 'openai') {
    return createOpenAI({
      apiKey: apiKey,
    })(model)
  }

  // Everyone else goes through OpenRouter
  // We assume the apiKey passed is suitable for OpenRouter if provider != openai
  return createOpenRouter({
    apiKey: apiKey,
  })(model)
}

// ─── Reasoning ──────────────────────────────────────────────────────────────

export async function reason(
  apiKey: string,
  model: string,
  chatHistory: ChatMessage[],
  screenshotBase64: string,
  domSnapshot: string,
  consoleErrors: string[],
  provider: string = 'openai',
  activeSkillContext?: string
): Promise<AgentAction> {
  const aiModel = getAiModel(provider, model, apiKey)

  // Build context
  let contextText = ''
  if (domSnapshot) {
    contextText += `## Interactive Elements\n${domSnapshot}\n\n`
  } else if (!screenshotBase64) {
    // If no DOM and no screenshot, likely no browser session
    contextText += `## System\nNo active browser session. To start testing, you MUST use the 'navigate' action with a URL.\n\n`
  }
  if (consoleErrors.length > 0) {
    contextText += `## Console Errors\n${consoleErrors.join('\n')}\n\n`
  }
  contextText += `Decide the next action. Respond with ONLY JSON.`

  // Convert chat history to AI SDK messages (filter out skill context for clean context)
  const messages: Array<{
    role: 'user' | 'assistant'
    content: string | Array<{ type: string; text?: string; image?: string; mimeType?: string }>
  }> = []

  for (const msg of chatHistory) {
    if (msg.isSkillContext) continue // clean context: skip consumed skill instructions
    messages.push({
      role: msg.role === 'user' ? 'user' : 'assistant',
      content: msg.content,
    })
  }

  // Add current visual context as final user message
  if (screenshotBase64) {
    messages.push({
      role: 'user',
      content: [
        { type: 'text', text: contextText },
        {
          type: 'image',
          image: screenshotBase64,
          mimeType: 'image/jpeg',
        },
      ],
    })
  } else {
    messages.push({ role: 'user', content: contextText })
  }

  let responseText: string
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await generateText({
      model: aiModel,
      system: buildSystemPrompt(activeSkillContext),
      messages: messages as any, // mixed text+image content parts
      maxOutputTokens: 4096,
      temperature: 0.1,
    })
    responseText = result.text.trim()
  } catch (err: unknown) {
    const errorObj = err as { status?: number; message?: string }
    const status = errorObj.status ?? 0
    const msg = errorObj.message ?? String(err)
    if (status === 429) {
      return {
        action: 'error' as const,
        message: 'Rate limited by LLM provider. Please wait a moment and try again.',
        reasoning: msg,
      }
    }
    if (status === 401 || status === 403) {
      return {
        action: 'error' as const,
        message: `Invalid API key for ${provider}. Check Settings → API Keys.`,
        reasoning: msg,
      }
    }
    return {
      action: 'error' as const,
      message: `LLM request failed (${provider}): ${msg}`,
      reasoning: 'API call threw an exception',
    }
  }

  return parseAction(responseText)
}

function parseAction(raw: string): AgentAction {
  let jsonStr = raw.trim()

  // Try to find the first '{' and last '}'
  const firstBrace = jsonStr.indexOf('{')
  const lastBrace = jsonStr.lastIndexOf('}')

  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    jsonStr = jsonStr.slice(firstBrace, lastBrace + 1)
  } else {
    // Fallback: remove markdown block markers if they exist
    const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim()
    }
  }

  try {
    const parsed = JSON.parse(jsonStr)

    // ─── Normalization ───────────────────────────────────────────────────────
    // Fix common LLM hallucinations before validation
    if (parsed.action === 'type_secret') {
      // LLM often uses 'text' instead of 'key' for type_secret
      if (!parsed.key && parsed.text) {
        parsed.key = parsed.text
        delete parsed.text
      }
    }

    // LLM can omit `reasoning` even though schema requires it
    if (parsed.action && !parsed.reasoning) {
      parsed.reasoning = 'Model omitted reasoning; auto-filled by parser.'
    }

    // Fix: LLM sometimes returns { "use_skill": "name" } instead of { "action": "use_skill", "skill_name": "name" }
    // This happens because "use_skill" is a unique discriminator in the prompt's examples list
    if (parsed.use_skill && !parsed.action) {
      parsed.action = 'use_skill'
      parsed.skill_name = parsed.use_skill
      delete parsed.use_skill
    }
    // ────────────────────────────────────────────────────────────────────────

    return ActionSchema.parse(parsed)
  } catch (err) {
    let errorMessage = 'LLM returned invalid JSON'
    if (err instanceof z.ZodError) {
      errorMessage = `Validation error: ${err.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', ')}`
    } else if (err instanceof SyntaxError) {
      errorMessage = `JSON Parse error: ${err.message}`
    }

    return {
      action: 'error',
      message: `Failed to parse LLM response: ${errorMessage}. Raw: ${raw.slice(0, 200)}`,
      reasoning: 'LLM returned invalid output',
    }
  }
}
// ─── Intent Classification (Router Layer) ───────────────────────────────────

export async function classifyIntent(
  apiKey: string,
  model: string,
  userMessage: string,
  provider: string = 'openai'
): Promise<{ action: 'use_skill' | 'proceed' | 'refuse'; skill_name?: string; reasoning: string }> {
  const aiModel = getAiModel(provider, model, apiKey)
  const skillMetadata = loadSkillMetadata()
  const skillSummary = formatSkillSummary(skillMetadata)

  const systemPrompt = `You are a strict Intent Classifier for a QA Agent.
Your job is to analyze the user's request and match it to an available skill, OR refuse it if it violates safety rules/negative triggers, OR let the general agent handle it.

${skillSummary}

Output JSON ONLY:
{
  "action": "use_skill" | "proceed" | "refuse",
  "skill_name": string (optional, if action is use_skill),
  "reasoning": string
}

Rules:
1. If the request matches a skill's description AND trigger conditions, return "use_skill".
2. If the request matches a skill's NEGATIVE triggers, return "refuse" with a clear reason.
3. If the request is a high-level workflow (e.g., "Log out", "Sign up", "Purchase", "Cancel subscription") and NO skill matches, return "refuse" stating that no skill exists for this workflow.
4. ONLY return "proceed" if the request is a low-level, explicit browser action (e.g., "click the button", "scroll down", "navigate to google.com", "type hello").
5. If the request is unsafe, illegal, or completely out of scope, return "refuse".
6. Login requests that describe normal username/email + password authentication should map to "standard-login".
7. Do NOT map to "standard-login" when login explicitly uses OAuth/SSO/provider auth (Google/GitHub/Facebook/Apple/Microsoft/passkey/magic link) or financial authorization.
`

  const lowerMsg = userMessage.toLowerCase()
  const loginIntent = /\b(log\s*in|login|sign\s*in|authenticate)\b/.test(lowerMsg)
  const oauthOrSsoIntent =
    /\b(oauth|sso|single\s*sign\s*on|google|github|facebook|apple|microsoft|passkey|magic\s*link)\b/.test(
      lowerMsg
    )
  const financialAuthIntent =
    /\b(bank|banking|wire\s*transfer|payment\s*authorization|financial\s*authorization)\b/.test(
      lowerMsg
    )
  const shouldUseStandardLogin = loginIntent && !oauthOrSsoIntent && !financialAuthIntent

  try {
    const result = await generateText({
      model: aiModel,
      system: systemPrompt,
      prompt: userMessage,
      temperature: 0.1,
    })

    const text = result.text.trim()
    // Simple JSON extraction
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as {
        action?: 'use_skill' | 'proceed' | 'refuse'
        skill_name?: string
        reasoning?: string
      }

      if (shouldUseStandardLogin) {
        return {
          action: 'use_skill',
          skill_name: 'standard-login',
          reasoning: 'Login intent detected; normalized to standard-login.',
        }
      }

      if (
        parsed.action === 'use_skill' ||
        parsed.action === 'proceed' ||
        parsed.action === 'refuse'
      ) {
        return {
          action: parsed.action,
          skill_name: parsed.skill_name,
          reasoning: parsed.reasoning ?? 'Classifier returned no reasoning.',
        }
      }
    }
    return {
      action: 'proceed',
      reasoning: 'Could not parse classifier output, defaulting to proceed.',
    }
  } catch (err) {
    console.warn('Intent classification failed:', err)
    return { action: 'proceed', reasoning: 'Classifier failed.' }
  }
}
