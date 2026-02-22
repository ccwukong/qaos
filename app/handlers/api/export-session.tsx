/**
 * API: Export session as a reusable test case JSON.
 *
 * GET /api/export/:sessionId → downloads a JSON test script
 */

import type { LoaderFunctionArgs } from 'react-router'
import { getDb, schema } from '~/db/db.server'
import { eq } from 'drizzle-orm'
import { requireUser } from '~/services/auth.server'

export async function loader({ params, request }: LoaderFunctionArgs) {
  await requireUser(request)

  const { sessionId } = params
  if (!sessionId) return new Response('Session ID required', { status: 400 })
  const db = await getDb()

  const sessionRows = await db
    .select()
    .from(schema.tests)
    .where(eq(schema.tests.id, sessionId))
    .limit(1)
  const session = sessionRows[0]

  if (!session) {
    return new Response('Session not found', { status: 404 })
  }

  const messages = await db
    .select()
    .from(schema.testMessages)
    .where(eq(schema.testMessages.testId, sessionId))

  // Extract user prompts for Smart Replay
  const steps: Array<{ action: string; detail: string }> = []
  for (const msg of messages) {
    // Only include user messages that are NOT excluded
    if (msg.role === 'user' && !msg.excluded) {
      steps.push({ action: 'prompt', detail: msg.content })
    }
  }

  const testCase = {
    name: session.title || 'Untitled Test',
    url: session.url || '',
    model: session.model,
    createdAt: session.createdAt,
    steps,
    messages: messages.map((m: { role: string; content: string; createdAt: string }) => ({
      role: m.role,
      content: m.content,
      timestamp: m.createdAt,
    })),
  }

  const filename = `qaos-test-${sessionId.slice(0, 8)}.json`

  return new Response(JSON.stringify(testCase, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
