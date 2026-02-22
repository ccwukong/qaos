import type { LoaderFunctionArgs } from 'react-router'
import { getLocalExecutorStatus } from '~/services/local-executor-registry.server'

export async function loader(_args: LoaderFunctionArgs) {
  const status = getLocalExecutorStatus()
  return new Response(
    JSON.stringify({
      connected: status.connected,
      lastSeenAt: status.lastSeenAt,
    }),
    {
      headers: { 'Content-Type': 'application/json' },
    }
  )
}
