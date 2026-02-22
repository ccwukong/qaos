import type { ActionFunctionArgs } from 'react-router'
import { getDb, schema } from '~/db/db.server'
import { eq } from 'drizzle-orm'
import { requireUser } from '~/services/auth.server'

export async function action({ request }: ActionFunctionArgs) {
  await requireUser(request)

  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  const { messageId, excluded } = await request.json()

  if (typeof messageId !== 'number' || typeof excluded !== 'boolean') {
    return new Response('Invalid payload', { status: 400 })
  }

  const db = await getDb()

  await db
    .update(schema.testMessages)
    .set({ excluded })
    .where(eq(schema.testMessages.id, messageId))

  return new Response(JSON.stringify({ success: true }), {
    headers: { 'Content-Type': 'application/json' },
  })
}
