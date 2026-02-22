/**
 * Test Workspace — split-screen: test feed (left) + live canvas (right)
 *
 * Canvas panel includes a red dot overlay at the agent's last click coordinates.
 */

import { useEffect, useRef, useState, useCallback } from 'react'
import { useLoaderData, useParams, NavLink } from 'react-router'
import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router'
import { getDb, schema } from '~/db/db.server'
import { eq, desc } from 'drizzle-orm'
import { redirect, Form, useSubmit } from 'react-router'
import { getLocalExecutorStatus } from '~/services/local-executor-registry.server'
import { resolveExecutionMode } from '~/services/executor-router.server'
import { requireUser } from '~/services/auth.server'

// ─── Action ─────────────────────────────────────────────────────────────────

export async function action({ request, params }: ActionFunctionArgs) {
  const { sessionId } = params
  if (!sessionId) throw new Response('Session ID required', { status: 400 })

  const formData = await request.formData()
  const intent = formData.get('_action')
  const targetSessionId = formData.get('sessionId') as string
  const newTitle = formData.get('newTitle') as string

  if (intent === 'rename' && targetSessionId && newTitle) {
    const db = await getDb()
    await db
      .update(schema.tests)
      .set({ title: newTitle })
      .where(eq(schema.tests.id, targetSessionId))
    return null
  }

  if (intent === 'delete' && targetSessionId) {
    const db = await getDb()
    // Delete messages first (if no cascade)
    await db.delete(schema.testMessages).where(eq(schema.testMessages.testId, targetSessionId))
    // Delete session
    await db.delete(schema.tests).where(eq(schema.tests.id, targetSessionId))

    // If we deleted the current session, redirect to the latest existing session
    if (sessionId === targetSessionId) {
      const latestRows = await db
        .select()
        .from(schema.tests)
        .orderBy(desc(schema.tests.createdAt))
        .limit(1)
      const latest = latestRows[0]

      if (latest) {
        return redirect(`/test/${latest.id}`)
      }
      return redirect('/')
    }
    return null
  }

  if (intent === 'set_test_account' && sessionId) {
    const db = await getDb()
    const selectedAccountId = (formData.get('testAccountId') as string) || null
    await db
      .update(schema.tests)
      .set({ testAccountId: selectedAccountId })
      .where(eq(schema.tests.id, sessionId))
    return null
  }

  return null
}

// ─── Loader ─────────────────────────────────────────────────────────────────

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requireUser(request)

  const { sessionId } = params
  if (!sessionId) throw new Response('Session ID required', { status: 400 })

  const db = await getDb()
  const sessionRows = await db
    .select()
    .from(schema.tests)
    .where(eq(schema.tests.id, sessionId))
    .limit(1)
  const session = sessionRows[0]
  if (!session) throw new Response('Session not found', { status: 404 })

  const msgs = await db
    .select()
    .from(schema.testMessages)
    .where(eq(schema.testMessages.testId, sessionId))

  const allSessions = await db
    .select()
    .from(schema.tests)
    .orderBy(desc(schema.tests.createdAt))
    .limit(30)

  const configRows = await db.select().from(schema.config)
  const cfg: Record<string, string> = {}
  for (const row of configRows) cfg[row.key] = row.value
  const activeModel = cfg.model ?? 'Unknown Model'

  const testAccounts = await db
    .select()
    .from(schema.testAccounts)
    .orderBy(desc(schema.testAccounts.createdAt))

  const localExecutorStatus = getLocalExecutorStatus()
  const deploymentMode = resolveExecutionMode()

  return {
    session,
    messages: msgs,
    sessions: allSessions,
    activeModel,
    testAccounts,
    localExecutorConnected: localExecutorStatus.connected,
    deploymentMode,
  }
}

// ─── Types ──────────────────────────────────────────────────────────────────

interface ChatMsg {
  id: number | string
  role: 'user' | 'agent' | 'system'
  content: string
  screenshotPath?: string | null
  excluded?: number | boolean // 0 or 1 (false/true)
}

interface SSEPayload {
  type: 'thought' | 'screenshot' | 'action' | 'done' | 'ask_human' | 'error'
  data: string
}

interface ClickDot {
  x: number
  y: number
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function ChatWorkspace() {
  const {
    session,
    messages: initialMessages,
    sessions,
    activeModel,
    testAccounts,
    localExecutorConnected: initialLocalExecutorConnected,
    deploymentMode,
  } = useLoaderData<typeof loader>()
  const { sessionId } = useParams()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [messages, setMessages] = useState<ChatMsg[]>(
    initialMessages.map((m: any) => ({
      id: m.id,
      role: m.role as 'user' | 'agent',
      content: m.content,
      screenshotPath: m.screenshotPath,
      excluded: m.excluded,
    }))
  )
  const [input, setInput] = useState('')
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null)
  const [isStreaming, setIsStreaming] = useState(false)
  const [latestScreenshot, setLatestScreenshot] = useState<string | null>(null)
  const [clickDot, setClickDot] = useState<ClickDot | null>(null)
  const [localExecutorConnected, setLocalExecutorConnected] = useState<boolean>(
    initialLocalExecutorConnected
  )
  const sessionExecutionMode = deploymentMode
  const chatEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const canvasImgRef = useRef<HTMLImageElement>(null)

  // Auto-scroll when new messages arrive (only if already near the bottom)
  useEffect(() => {
    const chatContainer = chatEndRef.current?.parentElement
    if (!chatContainer) return

    // Check if we are near the bottom (within 100px)
    const isNearBottom =
      chatContainer.scrollHeight - chatContainer.scrollTop - chatContainer.clientHeight < 100

    if (isNearBottom) {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages])

  // Reset state on session change (navigation)
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setMessages(
      initialMessages.map((m: any) => ({
        id: m.id,
        role: m.role as 'user' | 'agent',
        content: m.content,
        screenshotPath: m.screenshotPath,
        excluded: m.excluded,
      }))
    )
    setLatestScreenshot(null)
    setIsStreaming(false)
    setClickDot(null)
    setLocalExecutorConnected(initialLocalExecutorConnected)
  }, [initialMessages, sessionId])

  useEffect(() => {
    if (sessionExecutionMode !== 'hybrid') {
      return
    }

    let active = true
    let timer: ReturnType<typeof setInterval> | null = null

    const poll = async () => {
      try {
        const response = await fetch('/api/executor/status', { cache: 'no-store' })
        if (!response.ok) return
        const payload = (await response.json()) as { connected?: boolean }
        if (active) {
          setLocalExecutorConnected(Boolean(payload.connected))
        }
      } catch {
        if (active) {
          setLocalExecutorConnected(false)
        }
      }
    }

    poll()
    timer = setInterval(poll, 5000)

    return () => {
      active = false
      if (timer) clearInterval(timer)
    }
  }, [sessionExecutionMode])

  // Focus input
  useEffect(() => {
    inputRef.current?.focus()
  }, [sessionId])

  const sendMessage = useCallback(async () => {
    const text = input.trim()
    if (!text || isStreaming) return

    setInput('')
    setIsStreaming(true)
    setClickDot(null)

    // Add user message
    const userMsg: ChatMsg = { id: Date.now(), role: 'user', content: text }
    setMessages(prev => [...prev, userMsg])

    // Add placeholder for agent
    const agentMsgId = Date.now() + 1
    setMessages(prev => [...prev, { id: agentMsgId, role: 'agent', content: '...' }])

    try {
      // Connect to SSE
      const response = await fetch(`/api/test/${sessionId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      })

      if (!response.ok || !response.body) {
        let errorMsg = '⚠️ Failed to connect to agent.'
        try {
          // Attempt to parse explicit JSON error thrown by API
          const errData = await response.json()
          if (errData.error) errorMsg = `⚠️ ${errData.error}`
        } catch {
          /* Suppress parse errors and use fallback */
        }

        setMessages(prev => prev.map(m => (m.id === agentMsgId ? { ...m, content: errorMsg } : m)))
        setIsStreaming(false)
        return
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let agentText = ''
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const payload: SSEPayload = JSON.parse(line.slice(6))

            switch (payload.type) {
              case 'thought':
                agentText += (agentText ? '\n' : '') + payload.data
                setMessages(prev =>
                  prev.map(m => (m.id === agentMsgId ? { ...m, content: agentText } : m))
                )
                break

              case 'screenshot':
                setLatestScreenshot(payload.data)
                break

              case 'action': {
                // Parse action data — may be JSON with coordinates or plain string
                let actionLabel = payload.data
                try {
                  const actionData = JSON.parse(payload.data)
                  actionLabel = actionData.label || payload.data
                  // Update red dot overlay with click coordinates
                  if (actionData.x !== undefined && actionData.y !== undefined) {
                    setClickDot({ x: actionData.x, y: actionData.y })
                  }
                } catch {
                  // plain string action — no coordinates
                }
                agentText += (agentText ? '\n' : '') + `🎯 *${actionLabel}*`
                setMessages(prev =>
                  prev.map(m => (m.id === agentMsgId ? { ...m, content: agentText } : m))
                )
                break
              }

              case 'ask_human':
                agentText += (agentText ? '\n\n' : '') + `❓ ${payload.data}`
                setMessages(prev =>
                  prev.map(m => (m.id === agentMsgId ? { ...m, content: agentText } : m))
                )
                break

              case 'done':
                agentText += (agentText ? '\n\n' : '') + `✅ ${payload.data}`
                setMessages(prev =>
                  prev.map(m => (m.id === agentMsgId ? { ...m, content: agentText } : m))
                )
                break

              case 'error':
                agentText += (agentText ? '\n\n' : '') + `❌ ${payload.data}`
                setMessages(prev =>
                  prev.map(m => (m.id === agentMsgId ? { ...m, content: agentText } : m))
                )
                break
            }
          } catch {
            // ignore malformed SSE
          }
        }
      }
    } catch (err) {
      setMessages(prev =>
        prev.map(m =>
          m.id === agentMsgId ? { ...m, content: '⚠️ Connection error. Please try again.' } : m
        )
      )
    } finally {
      setIsStreaming(false)
    }
  }, [input, isStreaming, sessionId])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  // Calculate red dot position relative to the displayed image
  const getClickDotStyle = (): React.CSSProperties | null => {
    if (!clickDot || !canvasImgRef.current) return null

    const img = canvasImgRef.current
    // The browser viewport is 1280x800 (Puppeteer default)
    const viewportW = 1280
    const viewportH = 800

    const pctX = (clickDot.x / viewportW) * 100
    const pctY = (clickDot.y / viewportH) * 100

    return {
      left: `${pctX}%`,
      top: `${pctY}%`,
    }
  }

  const dotStyle = getClickDotStyle()

  return (
    <div className="workspace">
      {/* ─── Sidebar ─── */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <img src="/logo.svg" alt="qaos" />
          <span>qaos</span>
        </div>
        <a href="/" className="new-chat-btn">
          + New Test
        </a>
        <nav className="session-list">
          {sessions.map((s: { id: string; title: string | null }) => (
            <div key={s.id} className="session-item-wrapper" style={{ position: 'relative' }}>
              {editingSessionId === s.id ? (
                <Form method="post" className="w-full" onSubmit={() => setEditingSessionId(null)}>
                  <input type="hidden" name="sessionId" value={s.id} />
                  <input type="hidden" name="_action" value="rename" />
                  <input
                    type="text"
                    name="newTitle"
                    defaultValue={s.title || 'New Test'}
                    autoFocus
                    onBlur={e => {
                      if (e.target.form) e.target.form.requestSubmit()
                    }}
                    onKeyDown={e => {
                      if (e.key === 'Escape') setEditingSessionId(null)
                    }}
                    className="w-full rounded border border-gray-600 bg-gray-800 px-2 py-1 text-sm text-white outline-none focus:border-blue-500"
                    style={{ marginLeft: '10px', width: 'calc(100% - 20px)' }}
                  />
                </Form>
              ) : (
                <>
                  <NavLink
                    to={`/test/${s.id}`}
                    className={({ isActive }) => `session-item${isActive ? 'active' : ''}`}
                    style={{ paddingRight: '50px' }}
                  >
                    {s.title || 'New Test'}
                  </NavLink>
                  <div
                    style={{
                      position: 'absolute',
                      right: '5px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      zIndex: 10,
                      display: 'flex',
                      gap: '4px',
                    }}
                  >
                    <button
                      type="button"
                      onClick={e => {
                        e.preventDefault()
                        e.stopPropagation()
                        setEditingSessionId(s.id)
                      }}
                      className="edit-btn"
                      title="Rename Test"
                      style={{
                        background: 'transparent',
                        border: 'none',
                        cursor: 'pointer',
                        opacity: 0.6,
                        fontSize: '12px',
                      }}
                    >
                      ✏️
                    </button>
                    <Form
                      method="post"
                      style={{ display: 'inline' }}
                      onSubmit={e => {
                        if (!confirm('Are you sure you want to delete this test?')) {
                          e.preventDefault()
                          e.stopPropagation()
                        }
                      }}
                    >
                      <input type="hidden" name="sessionId" value={s.id} />
                      <button
                        type="submit"
                        name="_action"
                        value="delete"
                        className="delete-btn"
                        title="Delete Test"
                        style={{
                          background: 'transparent',
                          border: 'none',
                          cursor: 'pointer',
                          opacity: 0.6,
                          fontSize: '12px',
                        }}
                      >
                        🗑️
                      </button>
                    </Form>
                  </div>
                </>
              )}
            </div>
          ))}
        </nav>
        <a href="/settings" className="sidebar-settings-link">
          ⚙️ Settings
        </a>
        <div className="sidebar-footer">qaos Studio v1.0.0</div>
      </aside>

      {/* ─── Chat Panel ─── */}
      <div className="chat-panel">
        <div className="chat-header">
          <span className="chat-header-title">{session.title}</span>
          <div className="flex items-center justify-end gap-2">
            <Form method="post">
              <input type="hidden" name="_action" value="set_test_account" />
              <select
                name="testAccountId"
                defaultValue={session.testAccountId ?? ''}
                onChange={e => e.currentTarget.form?.requestSubmit()}
                className="rounded border bg-white px-2 py-1 text-xs"
                title="Test account for this session"
              >
                <option value="">No test account</option>
                {testAccounts.map((account: { id: string; label: string; accountKey: string }) => (
                  <option key={account.id} value={account.id}>
                    {account.label} ({account.accountKey})
                  </option>
                ))}
              </select>
            </Form>
            {isStreaming && (
              <button
                onClick={async () => {
                  await fetch(`/api/stop/${sessionId}`, { method: 'POST' })
                }}
                className="cursor-pointer rounded border border-red-500/20 bg-red-500/10 px-2 py-1 text-xs text-red-400 transition-colors hover:bg-red-500/20"
              >
                ⏹ Stop
              </button>
            )}
            <span className="text-xs text-gray-500">
              Mode: {sessionExecutionMode === 'hybrid' ? 'Hybrid' : 'Single-node'}
            </span>
            <span className="ml-2 font-mono text-xs text-gray-400">{activeModel}</span>
            <a
              href={`/api/export/${sessionId}`}
              download
              className="export-btn"
              title="Save as Test Case"
            >
              📥 Export
            </a>
            <a
              href={`/replay?sessionId=${sessionId}&mode=test`}
              className="export-btn"
              title="Replay (Re-evaluates User Prompts)"
            >
              ▶️ Replay
            </a>
          </div>
        </div>
        <div className="chat-feed">
          {sessionExecutionMode === 'hybrid' && (
            <div
              className={`mb-3 rounded border px-3 py-2 text-xs ${
                localExecutorConnected
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                  : 'border-amber-300 bg-amber-50 text-amber-800'
              }`}
            >
              {localExecutorConnected
                ? 'Local executor is connected. This test can run in Hybrid Mode.'
                : 'Hybrid Mode is selected, but no local executor is connected yet.'}
            </div>
          )}
          {messages.length === 0 && (
            <div className="chat-empty flex flex-col items-center justify-center">
              <img
                src="/logo.svg"
                alt="qaos"
                width="64"
                height="64"
                className="mb-4 block h-16 w-16"
              />
              <h2>qaos</h2>
              <p>Give me a URL and tell me what to test.</p>
            </div>
          )}
          {messages.map(msg => (
            <div key={msg.id} className={`chat-bubble ${msg.role}`}>
              <div className="bubble-role">
                {msg.role === 'user' ? (
                  'You'
                ) : (
                  <img
                    src="/logo.svg"
                    alt="qaos"
                    width="24"
                    height="24"
                    style={{ verticalAlign: 'middle' }}
                  />
                )}
              </div>
              <div className={`bubble-content ${msg.excluded ? 'excluded-msg' : ''}`}>
                {msg.content}
                {msg.excluded && <div className="excluded-badge">Excluded from Test</div>}
              </div>
              {msg.role === 'user' && (
                <div className="bubble-actions">
                  <button
                    onClick={async () => {
                      const newExcluded = !msg.excluded
                      // Optimistic UI update
                      setMessages(prev =>
                        prev.map(m =>
                          m.id === msg.id ? { ...m, excluded: newExcluded ? 1 : 0 } : m
                        )
                      )

                      await fetch('/api/message', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ messageId: msg.id, excluded: newExcluded }),
                      })
                    }}
                    className="exclude-btn"
                    title={msg.excluded ? 'Include in Replay' : 'Exclude from Replay'}
                  >
                    {msg.excluded ? 'Include in Replay' : 'Exclude from Replay'}
                  </button>
                </div>
              )}
            </div>
          ))}
          <div ref={chatEndRef} />
        </div>

        <div className="chat-input-bar">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder='Try: "Navigate to https://example.com and test the signup flow"'
            rows={1}
            disabled={isStreaming}
            className="chat-input"
          />
          <button
            onClick={sendMessage}
            disabled={isStreaming || !input.trim()}
            className="send-btn"
          >
            {isStreaming ? '⏳' : '↑'}
          </button>
        </div>
      </div>

      {/* ─── Live Canvas ─── */}
      <div className="canvas-panel">
        {latestScreenshot ? (
          <div className="canvas-overlay">
            <img
              ref={canvasImgRef}
              src={latestScreenshot}
              alt="Live browser screenshot"
              className="canvas-img"
            />
            {dotStyle && <div className="click-dot" style={dotStyle} />}
          </div>
        ) : (
          <div className="canvas-empty">
            <div className="canvas-empty-icon">🖥️</div>
            <p>Live browser view will appear here</p>
            <p className="canvas-hint">Send a message to start testing</p>
          </div>
        )}
      </div>
    </div>
  )
}
