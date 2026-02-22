/**
 * BrowserManager — Stateful Puppeteer Session Manager (server-side)
 *
 * Maps sessionId → live Puppeteer { browser, page } instance.
 * Keeps browsers alive during chat conversations.
 * Auto-garbage-collects idle sessions after IDLE_TIMEOUT.
 */

import puppeteer from 'puppeteer-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
import { type Browser, type Page } from 'puppeteer'

puppeteer.use(StealthPlugin())

interface BrowserSession {
  browser: Browser
  page: Page
  consoleErrors: string[]
  lastActivity: number
  headless: boolean
}

const IDLE_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes
const GC_INTERVAL_MS = 60 * 1000 // check every minute

class BrowserManager {
  private sessions = new Map<string, BrowserSession>()
  private gcTimer: ReturnType<typeof setInterval> | null = null

  private resolveHeadlessMode(requestedHeadless: boolean): boolean {
    const missingDisplayOnLinux = process.platform === 'linux' && !process.env.DISPLAY
    if (!requestedHeadless && missingDisplayOnLinux) {
      console.warn(
        '[BrowserManager] Headful requested but DISPLAY is unavailable on Linux. Falling back to headless=true.'
      )
      return true
    }
    return requestedHeadless
  }

  constructor() {
    // Start garbage collection
    this.gcTimer = setInterval(() => this.collectIdle(), GC_INTERVAL_MS)
  }

  /** Launch or retrieve a browser for a session */
  async getPage(sessionId: string, url?: string, headless: boolean = true): Promise<Page> {
    const effectiveHeadless = this.resolveHeadlessMode(headless)
    console.log(
      `[BrowserManager] getPage called for ${sessionId}. Url: ${url}, Headless: ${effectiveHeadless}`
    )
    let session = this.sessions.get(sessionId)
    let capturedUrl: string | undefined = undefined

    // If session exists but headless mode mismatch, close it (restart)
    if (session && session.headless !== effectiveHeadless) {
      console.log(
        `[BrowserManager] Headless mode changed (${session.headless} -> ${effectiveHeadless}). Restarting session ${sessionId}.`
      )
      try {
        capturedUrl = session.page.url()
        if (capturedUrl === 'about:blank') capturedUrl = undefined
      } catch {
        /* ignore */
      }

      await session.browser.close().catch(() => {})
      this.sessions.delete(sessionId)
      session = undefined
    }

    if (session) {
      try {
        // Verify session is still alive
        if (session.page.isClosed()) throw new Error('Page is closed')
        // Accessing url() also throws if the target is gone in some cases
        session.page.url()
      } catch (err) {
        console.log(`[BrowserManager] Session ${sessionId} appears dead. Restarting. Error: ${err}`)
        try {
          await session.browser.close()
        } catch {}
        this.sessions.delete(sessionId)
        session = undefined
      }
    }

    if (session) {
      session.lastActivity = Date.now()
      // Navigate if a new URL is provided
      if (url && url !== session.page.url()) {
        await session.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      }
      return session.page
    }

    // Use provided URL or captured one from previous session
    const targetUrl = url || capturedUrl

    // Launch new browser
    let browser: Browser
    try {
      console.log(
        `[BrowserManager] Launching new browser (Stealth). Headless: ${effectiveHeadless}`
      )
      browser = (await puppeteer.launch({
        headless: effectiveHeadless,
        defaultViewport: null, // allow resizing
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,800'],
      })) as unknown as Browser // Cast because puppeteer-extra return type might slightly mismatch standard puppeteer types
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (!effectiveHeadless && msg.toLowerCase().includes('missing x server')) {
        console.warn(
          '[BrowserManager] Headful launch failed due to missing X server. Retrying with headless=true.'
        )
        browser = (await puppeteer.launch({
          headless: true,
          defaultViewport: null,
          args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,800'],
        })) as unknown as Browser
      } else {
        throw new Error(
          `Failed to launch browser. Is Chromium installed? Run "npx puppeteer browsers install chrome". Details: ${msg}`
        )
      }
    }

    const pages = await browser.pages()
    const page = pages[0] || (await browser.newPage())

    // Set viewport explicitly if not null
    await page.setViewport({ width: 1280, height: 800 })

    const consoleErrors: string[] = []

    page.on('console', msg => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text())
      }
    })

    page.on('pageerror', err => {
      const msg = err instanceof Error ? err.message : String(err)
      consoleErrors.push(`Page Error: ${msg}`)
    })

    if (targetUrl) {
      try {
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        throw new Error(`Failed to navigate to ${targetUrl}: ${msg}`)
      }
    }

    session = {
      browser,
      page,
      consoleErrors,
      lastActivity: Date.now(),
      headless: effectiveHeadless,
    }
    this.sessions.set(sessionId, session)
    return page
  }

  /** Check if a session has an active browser */
  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId)
  }

  /** Get console errors for a session */
  getConsoleErrors(sessionId: string): string[] {
    const session = this.sessions.get(sessionId)
    if (!session) return []
    const errors = [...session.consoleErrors]
    session.consoleErrors.length = 0 // clear after reading
    return errors
  }

  /** Get simplified DOM snapshot */
  async getSimplifiedDOM(sessionId: string): Promise<string> {
    const session = this.sessions.get(sessionId)
    if (!session) return ''

    if (session.page.isClosed()) {
      console.log(`[BrowserManager] Page closed for ${sessionId}. Removing session.`)
      this.sessions.delete(sessionId)
      return ''
    }

    try {
      return (await session.page.evaluate(`
        (() => {
          const elements = [];
          const selectors = 'a, button, input, select, textarea, [role="button"], [onclick]';
          document.querySelectorAll(selectors).forEach((el, i) => {
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) return;
            const tag = el.tagName.toLowerCase();
            const text = (el.textContent || '').trim().slice(0, 80);
            const type = el.getAttribute('type') || '';
            const placeholder = el.getAttribute('placeholder') || '';
            const ariaLabel = el.getAttribute('aria-label') || '';
            const role = el.getAttribute('role') || '';
            const label = text || placeholder || ariaLabel || '[' + tag + ']';
            const cx = Math.round(rect.x + rect.width / 2);
            const cy = Math.round(rect.y + rect.height / 2);
            elements.push('[' + i + '] <' + tag + (type ? ' type="' + type + '"' : '') + (role ? ' role="' + role + '"' : '') + '> "' + label + '" @ (' + cx + ', ' + cy + ')');
          });
          return elements.join('\\n');
        })()
      `)) as string
    } catch (err) {
      console.warn(`[BrowserManager] Failed to get DOM for ${sessionId} (likely closed):`, err)
      this.sessions.delete(sessionId)
      return ''
    }
  }

  /** Capture screenshot, return base64 */
  async captureScreenshot(
    sessionId: string,
    outputDir: string,
    stepLabel: string
  ): Promise<{ base64: string; filePath: string } | null> {
    const session = this.sessions.get(sessionId)
    if (!session) return null

    const { existsSync, mkdirSync, writeFileSync } = await import('node:fs')
    const { join } = await import('node:path')

    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true })
    }

    const filename = `${stepLabel}.jpg`
    const filePath = join(outputDir, filename)

    if (session.page.isClosed()) {
      this.sessions.delete(sessionId)
      return null
    }

    try {
      const buffer = await session.page.screenshot({ type: 'jpeg', quality: 70 })
      writeFileSync(filePath, buffer)

      session.lastActivity = Date.now()

      return {
        base64: Buffer.from(buffer).toString('base64'),
        filePath,
      }
    } catch (err) {
      console.warn(`[BrowserManager] Screenshot failed for ${sessionId} (session lost):`, err)
      this.sessions.delete(sessionId)
      return null
    }
  }

  /** Execute an action on a session's page */
  async executeAction(
    sessionId: string,
    action: {
      action: string
      x?: number
      y?: number
      text?: string
      direction?: string
      url?: string
    },
    headless: boolean = true
  ): Promise<void> {
    let session = this.sessions.get(sessionId)

    // Lazy init for navigation if session doesn't exist
    if (!session && action.action === 'navigate' && action.url) {
      console.log(
        `[BrowserManager] Lazy init session ${sessionId} for navigation to ${action.url}. Headless: ${headless}`
      )
      await this.getPage(sessionId, action.url, headless)
      session = this.sessions.get(sessionId)
    }

    if (!session) return

    const page = session.page
    session.lastActivity = Date.now()

    if (session.page.isClosed()) {
      this.sessions.delete(sessionId)
      throw new Error(
        'Browser session was closed. Please start a new session or navigate to a URL.'
      )
    }

    try {
      switch (action.action) {
        case 'navigate':
          if (action.url) {
            await page.goto(action.url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
          }
          break

        case 'click':
          await page.mouse.click(action.x!, action.y!)
          await page.waitForNetworkIdle({ timeout: 5_000 }).catch(() => {})
          break

        case 'type':
          if (action.x !== undefined && action.y !== undefined) {
            // Triple-click natively selects all text within an input field cleanly
            await page.mouse.click(action.x, action.y, { clickCount: 3 })
            await new Promise(r => setTimeout(r, 100))
            // Press backspace to clear the selected text
            await page.keyboard.press('Backspace')
          }
          await page.keyboard.type(action.text!, { delay: 30 })
          break

        case 'scroll': {
          const distance = action.direction === 'down' ? 400 : -400
          await page.mouse.wheel({ deltaY: distance })
          await new Promise(r => setTimeout(r, 500))
          break
        }
      }
    } catch (err) {
      console.error(`[BrowserManager] Action failed for ${sessionId}:`, err)
      // If it looks like a detached frame error, clean up
      const msg = err instanceof Error ? err.message : String(err)
      if (
        msg.includes('detached Frame') ||
        msg.includes('Target closed') ||
        msg.includes('Session closed')
      ) {
        this.sessions.delete(sessionId)
        throw new Error(
          'Browser session lost (detached frame). Please navigate to a URL to restart.'
        )
      }
      throw err // Re-throw other errors (like selector not found, though we use coords)
    }
  }

  /** Close a specific session */
  async closeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (session) {
      await session.browser.close().catch(() => {})
      this.sessions.delete(sessionId)
    }
  }

  /** Garbage-collect idle sessions */
  private async collectIdle(): Promise<void> {
    const now = Date.now()
    for (const [id, session] of this.sessions) {
      if (now - session.lastActivity > IDLE_TIMEOUT_MS) {
        await session.browser.close().catch(() => {})
        this.sessions.delete(id)
        console.log(`[BrowserManager] GC'd idle session: ${id}`)
      }
    }
  }

  /** Shutdown all sessions */
  async shutdown(): Promise<void> {
    if (this.gcTimer) clearInterval(this.gcTimer)
    for (const [id, session] of this.sessions) {
      await session.browser.close().catch(() => {})
      this.sessions.delete(id)
    }
  }
}

// Singleton
export const browserManager = new BrowserManager()
