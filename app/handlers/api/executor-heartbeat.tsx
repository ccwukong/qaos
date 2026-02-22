import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router'
import {
  getLocalExecutorStatus,
  markLocalExecutorDisconnected,
  touchLocalExecutorHeartbeat,
} from '~/services/local-executor-registry.server'

function jsonStatusResponse() {
  const status = getLocalExecutorStatus()
  return new Response(
    JSON.stringify({ connected: status.connected, lastSeenAt: status.lastSeenAt }),
    { headers: { 'Content-Type': 'application/json' } }
  )
}

export async function loader(_args: LoaderFunctionArgs) {
  return jsonStatusResponse()
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  let connected = true
  try {
    const payload = (await request.json()) as { connected?: boolean }
    if (typeof payload.connected === 'boolean') {
      connected = payload.connected
    }
  } catch {
    // Empty/invalid body: treat as heartbeat ping (connected=true)
  }

  if (connected) {
    touchLocalExecutorHeartbeat()
  } else {
    markLocalExecutorDisconnected()
  }

  return jsonStatusResponse()
}
