import { describe, it, expect, vi, beforeEach } from 'vitest'

// We have to use actual import for the module after mocking
// However, the module exports an instance (browserManager) directly, so it gets evaluated immediately.
// We mock puppeteer-extra and its dependencies immediately before importing the target.
vi.mock('puppeteer-extra', () => ({
  default: {
    use: vi.fn(),
    launch: vi.fn().mockResolvedValue({
      pages: vi.fn().mockResolvedValue([
        {
          setViewport: vi.fn(),
          url: vi.fn().mockReturnValue('about:blank'),
          goto: vi.fn(),
          on: vi.fn(),
          isClosed: vi.fn().mockReturnValue(false),
        },
      ]),
      newPage: vi.fn(),
      close: vi.fn(),
    }),
  },
}))

vi.mock('puppeteer-extra-plugin-stealth', () => ({
  default: vi.fn(),
}))

describe('Browser Manager Service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should initialize the browserManager singleton', async () => {
    const { browserManager } = await import('~/services/browser.server')
    expect(browserManager).toBeDefined()
  })

  it('should launch a new browser when getPage is called for a new session', async () => {
    const { browserManager } = await import('~/services/browser.server')

    // Call getPage
    const page = await browserManager.getPage('test-session-1', 'https://example.com')

    expect(page).toBeDefined()
    expect(page.goto).toHaveBeenCalledWith('https://example.com', expect.any(Object))
  })

  it('should reuse the existing browser session if called again', async () => {
    const { browserManager } = await import('~/services/browser.server')

    const page1 = await browserManager.getPage('test-session-2', 'https://example.com')
    const page2 = await browserManager.getPage('test-session-2', 'https://example.com')

    expect(page1).toBe(page2)
    // goto is called again because our mock page.url() returns "about:blank"
    expect(page1.goto).toHaveBeenCalledTimes(2)
  })
})
