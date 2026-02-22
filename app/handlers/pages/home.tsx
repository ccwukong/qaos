/**
 * Index route — creates a new test session and redirects to it.
 */

import type { LoaderFunctionArgs } from 'react-router'
import { redirect } from 'react-router'
import { getDb, schema } from '~/db/db.server'
import { requireUser } from '~/services/auth.server'

function nanoid(size = 12) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let id = ''
  for (let i = 0; i < size; i++) {
    id += chars[Math.floor(Math.random() * chars.length)]
  }
  return id
}

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireUser(request)
  const db = await getDb()
  const id = nanoid()

  const defaultHeadless = process.env.HEADLESS !== 'false' // default to true (headless) unless explicit "false"

  await db
    .insert(schema.tests)
    .values({ id, title: 'New Test', headless: defaultHeadless, userId: user.id })

  return redirect(`/test/${id}`)
}

export default function Index() {
  return null
}
