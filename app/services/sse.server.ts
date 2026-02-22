/**
 * SSE Helper — Server-Sent Events stream for React Router
 *
 * Creates a ReadableStream that emits typed events to the client.
 * Event types: thought, screenshot, action, done, ask_human, error
 */

export interface SSEEvent {
  type: 'thought' | 'screenshot' | 'action' | 'done' | 'ask_human' | 'error' | 'step' | 'step_start'
  data: string
}

export function createSSEStream() {
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null

  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c
    },
    cancel() {
      controller = null
    },
  })

  const encoder = new TextEncoder()

  function send(event: SSEEvent) {
    if (!controller) return
    try {
      const payload = JSON.stringify({ type: event.type, data: event.data })
      controller.enqueue(encoder.encode(`data: ${payload}\n\n`))
    } catch {
      // stream may be closed
    }
  }

  function close() {
    if (controller) {
      try {
        controller.close()
      } catch {
        // already closed
      }
      controller = null
    }
  }

  return { stream, send, close }
}
