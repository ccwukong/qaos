import type { LoaderFunctionArgs } from 'react-router'
import { localExecutionAdapter } from '~/services/local-execution-adapter.server'
import {
  markLocalExecutorConnected,
  markLocalExecutorDisconnected,
} from '~/services/local-executor-registry.server'

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url)
  const token = url.searchParams.get('token')

  const secret = process.env.QAOS_EXECUTOR_SECRET
  if (secret && token !== secret) {
    return new Response('Unauthorized', { status: 401 })
  }

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder()
      markLocalExecutorConnected()

      const sendMsg = (msg: any) => {
        try {
          const payload = JSON.stringify(msg)
          controller.enqueue(encoder.encode(`data: ${payload}\n\n`))
        } catch {
          // stream closed
        }
      }

      localExecutionAdapter.registerConnection(sendMsg)

      sendMsg({
        type: 'executor.hello',
        executorId: 'server',
        version: '1.0',
        capabilities: {
          supportsHeadful: true,
          supportsScreenshots: true,
          supportsHumanTakeover: false,
        },
      })

      const interval = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': heartbeat\n\n'))
        } catch {
          clearInterval(interval)
        }
      }, 15000)

      request.signal.addEventListener('abort', () => {
        clearInterval(interval)
        localExecutionAdapter.disconnect()
        markLocalExecutorDisconnected()
        try {
          controller.close()
        } catch {}
      })
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
