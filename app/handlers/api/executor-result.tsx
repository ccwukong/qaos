import type { ActionFunctionArgs } from 'react-router'
import { localExecutionAdapter } from '~/services/local-execution-adapter.server'
import type { ExecutorProtocolMessage } from '~/services/executor-protocol'

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  const url = new URL(request.url)
  const token = url.searchParams.get('token')

  const secret = process.env.QAOS_EXECUTOR_SECRET
  if (secret && token !== secret) {
    return new Response('Unauthorized', { status: 401 })
  }

  try {
    const msg = (await request.json()) as ExecutorProtocolMessage

    if (msg.type === 'run.action_result') {
      localExecutionAdapter.handleResult(msg.stepId, msg.ok, undefined, msg.error)
    } else if (msg.type === 'run.observation') {
      localExecutionAdapter.handleObservation({
        screenshotRef: msg.screenshotRef,
        domSnapshot: msg.domSnapshot,
        consoleErrors: msg.consoleErrors,
      })
    }
  } catch (err) {
    return new Response('Invalid payload', { status: 400 })
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { 'Content-Type': 'application/json' },
  })
}
