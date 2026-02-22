import type { BrowserAction, ExecutionAdapter } from '~/services/execution-adapter.server'
import type { ExecutorProtocolMessage } from '~/services/executor-protocol'

interface PendingRequest {
  resolve: (value: any) => void
  reject: (reason?: any) => void
  timer: NodeJS.Timeout
}

export type SSEStreamSend = (msg: ExecutorProtocolMessage) => void

class LocalExecutionAdapter implements ExecutionAdapter {
  private activeStream: SSEStreamSend | null = null
  private pendingRequests = new Map<string, PendingRequest>()
  private stepCounter = 0
  private lastObservation: {
    base64?: string
    filePath?: string
    dom?: string
    console?: string[]
  } = {}

  registerConnection(sendMsgFn: SSEStreamSend) {
    this.activeStream = sendMsgFn
    console.log('[LocalExecutor] Connected')
  }

  disconnect() {
    console.log('[LocalExecutor] Disconnected')
    this.activeStream = null
    for (const req of this.pendingRequests.values()) {
      clearTimeout(req.timer)
      req.reject(new Error('Local executor disconnected'))
    }
    this.pendingRequests.clear()
  }

  hasSession(_sessionId: string): boolean {
    return this.activeStream !== null
  }

  handleResult(stepId: string, ok: boolean, data?: any, error?: string) {
    const req = this.pendingRequests.get(stepId)
    if (req) {
      clearTimeout(req.timer)
      this.pendingRequests.delete(stepId)
      if (ok) {
        req.resolve(data)
      } else {
        req.reject(new Error(error || 'Action failed'))
      }
    }
  }

  handleObservation(data: {
    screenshotRef?: string
    domSnapshot?: string
    consoleErrors?: string[]
  }) {
    if (data.screenshotRef) this.lastObservation.base64 = data.screenshotRef
    if (data.domSnapshot) this.lastObservation.dom = data.domSnapshot
    if (data.consoleErrors) this.lastObservation.console = data.consoleErrors
  }

  private async sendCommand<T>(
    sessionId: string,
    actionName: string,
    args: any = {},
    timeoutMs = 30000
  ): Promise<T> {
    if (!this.activeStream) {
      throw new Error(
        'Hybrid execution mode is selected but no local executor is connected yet. ' +
          "Run 'npm run executor' in a separate terminal to connect."
      )
    }

    const stepId = `step_${Date.now()}_${this.stepCounter++}`

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(stepId)
        reject(new Error(`Command ${actionName} timed out after ${timeoutMs}ms`))
      }, timeoutMs)

      this.pendingRequests.set(stepId, { resolve, reject, timer })

      this.activeStream!({
        type: 'run.next_action',
        runId: sessionId,
        stepId,
        action: actionName,
        args,
      })
    })
  }

  async getPage(sessionId: string, url?: string, headless?: boolean): Promise<unknown> {
    if (url) {
      await this.sendCommand(sessionId, 'goto', { url })
    }
    return {} // Mock page object
  }

  async captureScreenshot(
    sessionId: string,
    outputDir: string,
    stepLabel: string
  ): Promise<{ base64: string; filePath: string } | null> {
    const res = await this.sendCommand<any>(sessionId, 'getScreenshot', {})
    if (res && res.base64) {
      this.lastObservation.base64 = res.base64
      return { base64: res.base64, filePath: `${outputDir}/${stepLabel}.png` }
    }
    return null
  }

  async getSimplifiedDOM(sessionId: string): Promise<string> {
    const res = await this.sendCommand<any>(sessionId, 'getDOM', {})
    if (res && res.dom) {
      this.lastObservation.dom = res.dom
      return res.dom
    }
    return ''
  }

  getConsoleErrors(sessionId: string): string[] {
    return this.lastObservation.console || []
  }

  async executeAction(sessionId: string, action: BrowserAction, headless?: boolean): Promise<void> {
    await this.sendCommand(sessionId, action.action, action)
  }

  async closeSession(sessionId: string): Promise<void> {
    if (this.activeStream) {
      this.activeStream({ type: 'run.stop', runId: sessionId })
    }
  }
}

export const localExecutionAdapter = new LocalExecutionAdapter()
