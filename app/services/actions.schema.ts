/**
 * Agent Action Schema — Single Source of Truth
 *
 * Defines the JSON schema for all actions the agent can take.
 * This schema is used for:
 * 1. Runtime validation (Zod)
 * 2. System prompt generation (LLM-agnostic description)
 */

import { z } from 'zod'

export const ActionSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('navigate'),
      url: z.string().describe('The full URL to navigate to'),
      reasoning: z.string().describe('Why you are taking this action'),
    })
    .describe('Navigate to a specific URL'),

  z
    .object({
      action: z.literal('click'),
      x: z.number().describe('X coordinate of the element center'),
      y: z.number().describe('Y coordinate of the element center'),
      reasoning: z.string(),
    })
    .describe('Click at a specific coordinate'),

  z
    .object({
      action: z.literal('type'),
      x: z.number(),
      y: z.number(),
      text: z.string().describe('The text to type'),
      reasoning: z.string(),
    })
    .describe('Type text at a specific coordinate'),

  z
    .object({
      action: z.literal('scroll'),
      direction: z.enum(['up', 'down']),
      reasoning: z.string(),
    })
    .describe('Scroll the page up or down'),

  z
    .object({
      action: z.literal('ask_human'),
      question: z.string().describe('The question to ask the user'),
      reasoning: z.string(),
    })
    .describe('Ask the user for clarification or help'),

  z
    .object({
      action: z.literal('done'),
      summary: z.string().describe('Summary of what was accomplished'),
      reasoning: z.string(),
    })
    .describe('Complete the task'),

  z
    .object({
      action: z.literal('error'),
      message: z.string(),
      reasoning: z.string(),
    })
    .describe('Report a system error'),

  z
    .object({
      action: z.literal('use_skill'),
      skill_name: z.string().describe('The name of the skill to use'),
      reasoning: z.string(),
    })
    .describe('Execute a registered skill'),

  z
    .object({
      action: z.literal('type_secret'),
      key: z.string().describe('The .env variable name'),
      x: z.number().describe('X coordinate of the exact input field to type into'),
      y: z.number().describe('Y coordinate of the exact input field to type into'),
      reasoning: z.string(),
    })
    .describe('Securely type a secret from environment variables'),

  z
    .object({
      action: z.literal('type_test_account_secret'),
      field: z.enum(['username', 'password']).describe('Which selected test account field to type'),
      x: z.number().describe('X coordinate of the exact input field to type into'),
      y: z.number().describe('Y coordinate of the exact input field to type into'),
      reasoning: z.string(),
    })
    .describe(
      'Securely type selected test account username/password without exposing values to the LLM'
    ),

  z
    .object({
      action: z.literal('run_script'),
      skill_name: z.string(),
      script: z.string(),
      args: z.record(z.any()),
      reasoning: z.string(),
    })
    .describe('Run a script defined in a skill'),
])

export type AgentAction = z.infer<typeof ActionSchema>

/**
 * Generates the action list for the system prompt.
 * This ensures the prompt always matches the schema.
 */
export function getActionDescriptions(): string {
  const actions: string[] = []

  // We can extract this from the Zod schema if we want to be fancy,
  // but for now, let's keep it explicit and close to the definition.
  // The key is that this file is the ONLY place we define this.

  actions.push(
    `- {"action":"navigate","url":"<full_url>","reasoning":"<why>"} — Navigate to a new URL`
  )
  actions.push(
    `- {"action":"click","x":<num>,"y":<num>,"reasoning":"<why>"} — Click at x,y coordinates`
  )
  actions.push(
    `- {"action":"type","x":<num>,"y":<num>,"text":"<text>","reasoning":"<why>"} — Type text`
  )
  actions.push(`- {"action":"scroll","direction":"up"|"down","reasoning":"<why>"} — Scroll page`)
  actions.push(
    `- {"action":"ask_human","question":"<question>","reasoning":"<why>"} — Ask user for help`
  )
  actions.push(`- {"action":"done","summary":"<summary>","reasoning":"<why>"} — Task completed`)
  actions.push(`- {"action":"error","message":"<msg>","reasoning":"<why>"} — Report error`)
  actions.push(
    `- {"action":"use_skill","skill_name":"<name>","reasoning":"<why>"} — Invoke a skill`
  )
  actions.push(
    `- {"action":"type_secret","x":<num>,"y":<num>,"key":"<ENV_VAR>","reasoning":"<why>"} — Securely type non-account secret from .env (NEVER use 'text')`
  )
  actions.push(
    `- {"action":"type_test_account_secret","x":<num>,"y":<num>,"field":"username"|"password","reasoning":"<why>"} — Securely type selected test account credential (value never shown to LLM)`
  )
  actions.push(
    `- {"action":"run_script","skill_name":"<name>","script":"<script>","args":{...},"reasoning":"<why>"} — Run skill script`
  )

  return actions.join('\n')
}
