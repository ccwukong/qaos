/**
 * API: Logout — destroy session and redirect to login
 */

import type { ActionFunctionArgs } from 'react-router'
import { destroySession, clearSessionCookie } from '~/services/auth.server'

export async function action({ request }: ActionFunctionArgs) {
  await destroySession(request)

  return new Response(null, {
    status: 302,
    headers: {
      Location: '/login',
      'Set-Cookie': clearSessionCookie(),
    },
  })
}
