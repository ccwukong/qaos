import type { ActionFunctionArgs } from 'react-router'
import { getDb, schema } from '~/db/db.server'
import { eq } from 'drizzle-orm'
import { requireUser } from '~/services/auth.server'

export async function action({ request, params }: ActionFunctionArgs) {
  await requireUser(request)

  const { sessionId } = params
  if (!sessionId) return new Response('Session ID required', { status: 400 })
  const db = await getDb()

  // Update session status to "stopped"
  console.log(`[API] Stopping session ${sessionId}...`)
  await db.update(schema.tests).set({ status: 'stopped' }).where(eq(schema.tests.id, sessionId))
  console.log(`[API] Session ${sessionId} marked as stopped.`)

  return new Response(JSON.stringify({ success: true }), {
    headers: { 'Content-Type': 'application/json' },
  })
}
