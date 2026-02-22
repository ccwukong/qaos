/**
 * Replay Page — Load and replay exported test case JSON files
 */

import { useState, useRef, useCallback } from 'react'
import { NavLink } from 'react-router'

// ─── Types ──────────────────────────────────────────────────────────────────

interface TestCase {
  name: string
  url: string
  steps: Array<{ action: string; detail: string }>
  messages: Array<{ role: string; content: string; timestamp?: string }>
  mode?: 'classic' | 'test' // "classic" = exact recorded actions, "test" = re-evaluate user prompts
}

interface ReplayEvent {
  type: 'status' | 'screenshot' | 'step' | 'done' | 'error' | 'thought' | 'step_start'
  data: string
}

interface ReplayMessage {
  id: string
  role: 'user' | 'agent'
  content: string
  status?: 'pending' | 'running' | 'done' | 'error'
}

import { useLoaderData, useSearchParams } from 'react-router'
import { getDb, schema } from '~/db/db.server'
import { eq } from 'drizzle-orm'
import type { LoaderFunctionArgs } from 'react-router'
import { requireUser } from '~/services/auth.server'

// ─── Loader ─────────────────────────────────────────────────────────────────

export async function loader({ request }: LoaderFunctionArgs) {
  await requireUser(request)

  const url = new URL(request.url)
  const sessionId = url.searchParams.get('sessionId')
  const mode = url.searchParams.get('mode') === 'test' ? 'test' : 'classic'

  if (!sessionId) return { testCase: null }

  const db = await getDb()
  const sessionRows = await db
    .select()
    .from(schema.tests)
    .where(eq(schema.tests.id, sessionId))
    .limit(1)
  const session = sessionRows[0]
  if (!session) return { testCase: null }

  const messages = await db
    .select()
    .from(schema.testMessages)
    .where(eq(schema.testMessages.testId, sessionId))

  // Filter out excluded messages
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const validMessages = messages.filter((m: any) => !m.excluded)

  // Replay Mode: Steps are User Prompts (commands) for both modes
  // (We enforce Smart Replay basically by only parsing user intents now)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const steps: Array<{ action: string; detail: string }> = validMessages
    .filter((m: any) => m.role === 'user')
    .map((m: any) => ({
      action: 'prompt',
      detail: m.content,
    }))

  const testCase: TestCase = {
    name: session.title || 'Untitled',
    url: session.url || '',
    steps,
    messages: [], // not needed for replay execution, just display?
    mode,
  }

  return { testCase }
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function Replay() {
  const { testCase: initialTestCase } = useLoaderData<typeof loader>()
  const [searchParams] = useSearchParams()
  const sourceSessionId = searchParams.get('sessionId')
  const [testCase, setTestCase] = useState<TestCase | null>(initialTestCase || null)
  const [isReplaying, setIsReplaying] = useState(false)
  const [messages, setMessages] = useState<ReplayMessage[]>(() => {
    if (initialTestCase?.steps) {
      return initialTestCase.steps.map((s, i) => ({
        id: `prompt-${i}`,
        role: 'user',
        content: s.detail,
        status: 'pending',
      }))
    }
    return []
  })
  const [currentStepIndex, setCurrentStepIndex] = useState<number>(-1)
  const [currentReplayId, setCurrentReplayId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)

  const loadFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = ev => {
      try {
        const json = JSON.parse(ev.target?.result as string)
        setTestCase(json)

        // Initialize UI with user steps
        if (json.steps) {
          const initMessages: ReplayMessage[] = json.steps.map((s: any, i: number) => ({
            id: `prompt-${i}`,
            role: 'user',
            content: s.detail,
            status: 'pending',
          }))
          setMessages(initMessages)
        }
      } catch {
        alert('Invalid JSON file')
      }
    }
    reader.readAsText(file)
  }, [])

  const startReplay = useCallback(async () => {
    if (!testCase || isReplaying) return

    // Reset agent messages, keep user prompts
    setMessages(prev => prev.filter(m => m.role === 'user').map(m => ({ ...m, status: 'pending' })))
    setCurrentStepIndex(-1)
    setIsReplaying(true)

    const newReplayId = `replay-${Date.now()}`
    setCurrentReplayId(newReplayId)

    try {
      const response = await fetch('/api/replay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Send a generated replayId so we know what ID to stop later
        body: JSON.stringify({ ...testCase, replayId: newReplayId }),
      })

      if (!response.ok || !response.body) {
        setIsReplaying(false)
        setCurrentReplayId(null)
        return
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      let activeAgentMessageId = ''
      let activeAgentContent = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const event: ReplayEvent = JSON.parse(line.slice(6))

            if (event.type === 'step_start') {
              const stepIdx = parseInt(event.data, 10)
              setCurrentStepIndex(stepIdx)

              // Mark user prompt as running
              setMessages(prev =>
                prev.map(m => (m.id === `prompt-${stepIdx}` ? { ...m, status: 'running' } : m))
              )

              // Create new agent bubble for this step
              activeAgentMessageId = `agent-${stepIdx}`
              activeAgentContent = ''
              setMessages(prev => [
                ...prev,
                { id: activeAgentMessageId, role: 'agent', content: '...' },
              ])
              continue
            }

            // Append to active agent bubble
            if (
              activeAgentMessageId &&
              (event.type === 'thought' ||
                event.type === 'status' ||
                event.type === 'step' ||
                event.type === 'error')
            ) {
              const prefix =
                event.type === 'error'
                  ? '❌ '
                  : event.type === 'step'
                    ? '🎯 '
                    : event.type === 'status'
                      ? 'ℹ️ '
                      : ''
              activeAgentContent += (activeAgentContent === '...' ? '' : '\n') + prefix + event.data

              setMessages(prev =>
                prev.map(m =>
                  m.id === activeAgentMessageId
                    ? {
                        ...m,
                        content: activeAgentContent,
                        status: event.type === 'error' ? 'error' : 'running',
                      }
                    : m
                )
              )
            }

            if (event.type === 'done') {
              // Mark last step as donede
              setMessages(prev =>
                prev.map(m => (m.status === 'running' ? { ...m, status: 'done' } : m))
              )
            }
          } catch {
            // ignore malformed SSE
          }
        }
      }
    } catch (err) {
      console.error(err)
    } finally {
      setIsReplaying(false)
      setCurrentStepIndex(-1)
      setCurrentReplayId(null)
    }
  }, [testCase, isReplaying])

  const stopReplay = useCallback(async () => {
    if (!currentReplayId) return
    try {
      await fetch(`/api/stop/${currentReplayId}`, { method: 'POST' })
    } catch (err) {
      console.error('Failed to stop replay:', err)
    }
  }, [currentReplayId])

  // Auto-scroll chat Feed
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const scrollLog = () => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })

  // Sort messages to interleave them correctly
  // User messages have ID 'prompt-X', agent messages have 'agent-X'
  const sortedMessages = [...messages].sort((a, b) => {
    const aMatch = a.id.match(/-(\d+)/)
    const bMatch = b.id.match(/-(\d+)/)
    const aIdx = aMatch ? parseInt(aMatch[1]) : 0
    const bIdx = bMatch ? parseInt(bMatch[1]) : 0

    if (aIdx !== bIdx) return aIdx - bIdx

    // If same index, user prompt comes first
    return a.role === 'user' ? -1 : 1
  })

  // Filter messages for display:
  // If we haven't started (currentStepIndex === -1 && !isReplaying), show ALL user prompts to preview the test.
  // If we ARE replaying (or finished), ONLY show messages up to the currentStepIndex.
  const visibleMessages = sortedMessages.filter(msg => {
    if (!isReplaying && currentStepIndex === -1) return true // Preview mode
    const match = msg.id.match(/-(\d+)/)
    const idx = match ? parseInt(match[1]) : 0
    return idx <= currentStepIndex
  })

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
          <NavLink to="/replay" className="session-item active">
            🔄 Replay
          </NavLink>
        </nav>
        <a href="/settings" className="sidebar-settings-link">
          ⚙️ Settings
        </a>
        <div className="sidebar-footer">qaos Studio v0.1.0</div>
      </aside>

      {/* ─── Replay Panel ─── */}
      <div className="chat-panel">
        <div className="chat-header">
          {sourceSessionId && (
            <NavLink
              to={`/test/${sourceSessionId}`}
              className="export-btn"
              style={{ textDecoration: 'none', marginRight: '12px' }}
            >
              ← Back
            </NavLink>
          )}
          <span className="chat-header-title">
            {testCase
              ? `🔄 ${testCase.name} (${testCase.mode === 'test' ? 'Smart Replay' : 'Classic Replay'})`
              : '🔄 Replay Session'}
          </span>
        </div>

        <div className="chat-feed">
          {!testCase && (
            <div className="chat-empty">
              <h2>🔄 Replay a Session</h2>
              <p>Load an exported JSON replay file to play it.</p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                onChange={loadFile}
                style={{ display: 'none' }}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="send-btn"
                style={{
                  width: 'auto',
                  padding: '10px 24px',
                  fontSize: '14px',
                  borderRadius: '8px',
                  cursor: 'pointer',
                }}
              >
                📂 Load JSON File
              </button>
            </div>
          )}

          {visibleMessages.map(msg => (
            <div key={msg.id} className={`chat-bubble ${msg.role}`}>
              <div className="bubble-role">
                {msg.role === 'user' ? 'User Prompt' : 'Agent Replay'}
                {msg.status === 'running' && <span style={{ marginLeft: 8 }}>⏳</span>}
                {msg.status === 'done' && <span style={{ marginLeft: 8 }}>✅</span>}
                {msg.status === 'error' && <span style={{ marginLeft: 8 }}>❌</span>}
              </div>
              <div className="bubble-content">{msg.content}</div>
            </div>
          ))}
          <div ref={chatEndRef} onFocus={scrollLog} />
        </div>

        {testCase && (
          <div className="chat-input-bar">
            {isReplaying ? (
              <button
                onClick={stopReplay}
                className="send-btn stop-btn"
                style={{ width: '100%', borderRadius: '12px', background: '#ff3b30' }}
              >
                🛑 Stop
              </button>
            ) : (
              <button
                onClick={startReplay}
                className="send-btn"
                style={{ width: '100%', borderRadius: '12px' }}
              >
                ▶️ Run Replay
              </button>
            )}
          </div>
        )}
      </div>

      {/* ─── Live Canvas (Hidden in forced Headed Mode) ─── */}
      {/* Canvas removed as per user request to use headed mode only */}
    </div>
  )
}
