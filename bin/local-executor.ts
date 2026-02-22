import puppeteer from 'puppeteer-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
import type { Browser, Page } from 'puppeteer'
import { parseArgs } from 'node:util'

puppeteer.use(StealthPlugin())

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    url: { type: 'string', default: 'http://localhost:3000' },
    token: { type: 'string', default: process.env.QAOS_EXECUTOR_SECRET || '' },
  },
})

const SERVER_URL = values.url!.replace(/\/$/, '')
const TOKEN = values.token || ''

// We manage a single session for the local executor
let browser: Browser | null = null
let page: Page | null = null
let currentRunId: string | null = null

async function getBrowserPage(): Promise<Page> {
  if (page && !page.isClosed()) return page

  if (!browser || !browser.connected) {
    console.log('[Executor] Launching local browser...')
    browser = await puppeteer.launch({
      headless: false, // Local executor typically shows what it's doing
      defaultViewport: null,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,800'],
    })
  }

  const pages = await browser.pages()
  page = pages[0] || (await browser.newPage())
  await page.setViewport({ width: 1280, height: 800 })
  return page
}

async function sendResult(type: 'run.action_result' | 'run.observation', payload: any) {
  const urlParams = new URLSearchParams()
  if (TOKEN) urlParams.set('token', TOKEN)

  const res = await fetch(`${SERVER_URL}/api/executor/result?${urlParams.toString()}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, ...payload }),
  })

  if (!res.ok) {
    console.error(`[Executor] Failed to send result: ${res.statusText}`)
  }
}

async function handleAction(msg: any) {
  currentRunId = msg.runId
  const { stepId, action, args } = msg

  try {
    const p = await getBrowserPage()

    if (action === 'goto') {
      await p.goto(args.url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      await sendResult('run.action_result', { runId: currentRunId, stepId, ok: true })
      return
    }

    if (action === 'getDOM') {
      const dom = await p.evaluate(`
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
      `)
      await sendResult('run.observation', { runId: currentRunId, domSnapshot: dom })
      await sendResult('run.action_result', { runId: currentRunId, stepId, ok: true })
      return
    }

    if (action === 'getScreenshot') {
      const buffer = await p.screenshot({ type: 'jpeg', quality: 70 })
      const base64 = Buffer.from(buffer).toString('base64')
      await sendResult('run.observation', { runId: currentRunId, screenshotRef: base64 })
      await sendResult('run.action_result', { runId: currentRunId, stepId, ok: true })
      return
    }

    // Standard action (click, type, scroll, navigate)
    if (action === 'navigate') {
      if (args.url) await p.goto(args.url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    } else if (action === 'click') {
      await p.mouse.click(args.x, args.y)
      await p.waitForNetworkIdle({ timeout: 5_000 }).catch(() => {})
    } else if (action === 'type') {
      if (args.x !== undefined && args.y !== undefined) {
        await p.mouse.click(args.x, args.y, { clickCount: 3 })
        await new Promise(r => setTimeout(r, 100))
        await p.keyboard.press('Backspace')
      }
      await p.keyboard.type(args.text, { delay: 30 })
    } else if (action === 'scroll') {
      const distance = args.direction === 'down' ? 400 : -400
      await p.mouse.wheel({ deltaY: distance })
      await new Promise(r => setTimeout(r, 500))
    }

    await sendResult('run.action_result', { runId: currentRunId, stepId, ok: true })
  } catch (err: any) {
    console.error(`[Executor] Error in action ${action}:`, err.message)
    await sendResult('run.action_result', {
      runId: currentRunId,
      stepId,
      ok: false,
      error: err.message,
    })
  }
}

async function main() {
  console.log(`[Executor] Connecting to ${SERVER_URL}...`)

  const urlParams = new URLSearchParams()
  if (TOKEN) urlParams.set('token', TOKEN)

  const res = await fetch(`${SERVER_URL}/api/executor/connect?${urlParams.toString()}`)
  if (!res.ok || !res.body) {
    console.error(`[Executor] Failed to connect: ${res.status} ${res.statusText}`)
    process.exit(1)
  }

  console.log('[Executor] Connected! Listening for commands...')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    try {
      const { value, done } = await reader.read()
      if (done) {
        console.log('[Executor] Disconnected from server.')
        break
      }

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n\n')
      buffer = lines.pop() || ''

      for (const block of lines) {
        if (!block.trim() || !block.startsWith('data: ')) continue
        const jsonData = block.substring(6)

        try {
          const msg = JSON.parse(jsonData)
          if (msg.type === 'run.next_action') {
            console.log(`[Executor] Received action: ${msg.action}`)
            await handleAction(msg)
          } else if (msg.type === 'run.stop') {
            console.log(`[Executor] Stopping run ${msg.runId}`)
            if (browser) {
              await browser.close().catch(() => {})
              browser = null
              page = null
            }
          }
        } catch (err) {
          console.error('[Executor] Failed to parse message', err)
        }
      }
    } catch (err) {
      console.error('[Executor] Connection error', err)
      break
    }
  }

  if (browser) await browser.close().catch(() => {})
  process.exit(0)
}

main().catch(console.error)
