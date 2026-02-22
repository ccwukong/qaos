import { browserManager } from '~/services/browser.server'

export interface BrowserAction {
  action: string
  x?: number
  y?: number
  text?: string
  direction?: string
  url?: string
}

export interface ExecutionAdapter {
  hasSession(sessionId: string): boolean
  getPage(sessionId: string, url?: string, headless?: boolean): Promise<unknown>
  captureScreenshot(
    sessionId: string,
    outputDir: string,
    stepLabel: string
  ): Promise<{ base64: string; filePath: string } | null>
  getSimplifiedDOM(sessionId: string): Promise<string>
  getConsoleErrors(sessionId: string): string[]
  executeAction(sessionId: string, action: BrowserAction, headless?: boolean): Promise<void>
  closeSession(sessionId: string): Promise<void>
}

class ServerExecutionAdapter implements ExecutionAdapter {
  hasSession(sessionId: string): boolean {
    return browserManager.hasSession(sessionId)
  }

  getPage(sessionId: string, url?: string, headless: boolean = true): Promise<unknown> {
    return browserManager.getPage(sessionId, url, headless)
  }

  captureScreenshot(
    sessionId: string,
    outputDir: string,
    stepLabel: string
  ): Promise<{ base64: string; filePath: string } | null> {
    return browserManager.captureScreenshot(sessionId, outputDir, stepLabel)
  }

  getSimplifiedDOM(sessionId: string): Promise<string> {
    return browserManager.getSimplifiedDOM(sessionId)
  }

  getConsoleErrors(sessionId: string): string[] {
    return browserManager.getConsoleErrors(sessionId)
  }

  executeAction(sessionId: string, action: BrowserAction, headless: boolean = true): Promise<void> {
    return browserManager.executeAction(sessionId, action, headless)
  }

  closeSession(sessionId: string): Promise<void> {
    return browserManager.closeSession(sessionId)
  }
}

export const executionAdapter: ExecutionAdapter = new ServerExecutionAdapter()
