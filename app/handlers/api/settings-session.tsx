import type { ActionFunctionArgs } from 'react-router'
import { getDb, schema } from '~/db/db.server'
import { eq } from 'drizzle-orm'
import { getExecutionAdapter } from '~/services/executor-router.server'
import { requireUser } from '~/services/auth.server'

export async function action({ request, params }: ActionFunctionArgs) {
  await requireUser(request)

  const { sessionId } = params
  if (!sessionId) return new Response('Session ID required', { status: 400 })
  const db = await getDb()
  const formData = await request.formData()

  const headless = formData.get('headless') === 'true'

  // Update session
  await db.update(schema.tests).set({ headless: headless }).where(eq(schema.tests.id, sessionId))

  const executionAdapter = getExecutionAdapter()

  // Force immediate browser relaunch/update
  try {
    // This will trigger the restart logic if mode changed
    await executionAdapter.getPage(sessionId, undefined, headless)
  } catch (err) {
    console.error('Failed to relaunch browser:', err)
  }

  return new Response(JSON.stringify({ success: true, headless }), {
    headers: { 'Content-Type': 'application/json' },
  })
}
