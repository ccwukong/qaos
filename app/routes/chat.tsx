/**
 * Chat Workspace — split-screen: chat feed (left) + live canvas (right)
 *
 * Canvas panel includes a red dot overlay at the agent's last click coordinates.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { useLoaderData, useParams, NavLink } from "react-router";
import type { Route } from "./+types/chat";
import { getDb, schema } from "~/db/db.server";
import { eq, desc } from "drizzle-orm";
import { redirect, Form, useSubmit } from "react-router";

// ─── Action ─────────────────────────────────────────────────────────────────

export async function action({ request, params }: Route.ActionArgs) {
  const formData = await request.formData();
  const intent = formData.get("_action");
  const targetSessionId = formData.get("sessionId") as string;
  const newTitle = formData.get("newTitle") as string;

  if (intent === "rename" && targetSessionId && newTitle) {
    const db = getDb();
    await db.update(schema.sessions)
      .set({ title: newTitle })
      .where(eq(schema.sessions.id, targetSessionId));
    return null;
  }

  if (intent === "delete" && targetSessionId) {
    const db = getDb();
    // Delete messages first (if no cascade)
    await db.delete(schema.messages).where(eq(schema.messages.sessionId, targetSessionId));
    // Delete session
    await db.delete(schema.sessions).where(eq(schema.sessions.id, targetSessionId));

    // If we deleted the current session, redirect to the latest existing session
    if (params.sessionId === targetSessionId) {
      const latest = db
        .select()
        .from(schema.sessions)
        .orderBy(desc(schema.sessions.createdAt))
        .limit(1)
        .get();

      if (latest) {
        return redirect(`/chat/${latest.id}`);
      }
      return redirect("/");
    }
    return null;
  }
  return null;
}

// ─── Loader ─────────────────────────────────────────────────────────────────

export async function loader({ params }: Route.LoaderArgs) {
  const db = getDb();
  const session = db.select().from(schema.sessions).where(eq(schema.sessions.id, params.sessionId)).get();
  if (!session) throw new Response("Session not found", { status: 404 });

  const msgs = db
    .select()
    .from(schema.messages)
    .where(eq(schema.messages.sessionId, params.sessionId))
    .all();

  const allSessions = db
    .select()
    .from(schema.sessions)
    .orderBy(desc(schema.sessions.createdAt))
    .limit(30)
    .all();

  const configRows = db.select().from(schema.config).all();
  const cfg: Record<string, string> = {};
  for (const row of configRows) cfg[row.key] = row.value;
  const activeModel = cfg.model ?? "Unknown Model";

  return { session, messages: msgs, sessions: allSessions, activeModel };
}

// ─── Types ──────────────────────────────────────────────────────────────────

interface ChatMsg {
  id: number | string;
  role: "user" | "agent" | "system";
  content: string;
  screenshotPath?: string | null;
  excluded?: number | boolean; // 0 or 1 (false/true)
}

interface SSEPayload {
  type: "thought" | "screenshot" | "action" | "done" | "ask_human" | "error";
  data: string;
}

interface ClickDot {
  x: number;
  y: number;
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function ChatWorkspace() {
  const { session, messages: initialMessages, sessions, activeModel } = useLoaderData<typeof loader>();
  const { sessionId } = useParams();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [messages, setMessages] = useState<ChatMsg[]>(
    initialMessages.map((m: any) => ({
      id: m.id,
      role: m.role as "user" | "agent",
      content: m.content,
      screenshotPath: m.screenshotPath,
      excluded: m.excluded,
    }))
  );
  const [input, setInput] = useState("");
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [latestScreenshot, setLatestScreenshot] = useState<string | null>(null);
  const [clickDot, setClickDot] = useState<ClickDot | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const canvasImgRef = useRef<HTMLImageElement>(null);

  // Auto-scroll when new messages arrive (only if already near the bottom)
  useEffect(() => {
    const chatContainer = chatEndRef.current?.parentElement;
    if (!chatContainer) return;
    
    // Check if we are near the bottom (within 100px)
    const isNearBottom = chatContainer.scrollHeight - chatContainer.scrollTop - chatContainer.clientHeight < 100;
    
    if (isNearBottom) {
      chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  // Reset state on session change (navigation)
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setMessages(
      initialMessages.map((m: any) => ({
        id: m.id,
        role: m.role as "user" | "agent",
        content: m.content,
        screenshotPath: m.screenshotPath,
        excluded: m.excluded,
      }))
    );
    setLatestScreenshot(null);
    setIsStreaming(false);
    setClickDot(null);
  }, [initialMessages, sessionId]);

  // Focus input
  useEffect(() => {
    inputRef.current?.focus();
  }, [sessionId]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || isStreaming) return;

    setInput("");
    setIsStreaming(true);
    setClickDot(null);

    // Add user message
    const userMsg: ChatMsg = { id: Date.now(), role: "user", content: text };
    setMessages((prev) => [...prev, userMsg]);

    // Add placeholder for agent
    const agentMsgId = Date.now() + 1;
    setMessages((prev) => [...prev, { id: agentMsgId, role: "agent", content: "..." }]);

    try {
      // Connect to SSE
      const response = await fetch(`/api/chat/${sessionId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });

      if (!response.ok || !response.body) {
        let errorMsg = "⚠️ Failed to connect to agent.";
        try {
          // Attempt to parse explicit JSON error thrown by API
          const errData = await response.json();
          if (errData.error) errorMsg = `⚠️ ${errData.error}`;
        } catch { /* Suppress parse errors and use fallback */ }

        setMessages((prev) =>
          prev.map((m) =>
            m.id === agentMsgId
              ? { ...m, content: errorMsg }
              : m
          )
        );
        setIsStreaming(false);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let agentText = "";
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const payload: SSEPayload = JSON.parse(line.slice(6));

            switch (payload.type) {
              case "thought":
                agentText += (agentText ? "\n" : "") + payload.data;
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === agentMsgId ? { ...m, content: agentText } : m
                  )
                );
                break;

              case "screenshot":
                setLatestScreenshot(payload.data);
                break;

              case "action": {
                // Parse action data — may be JSON with coordinates or plain string
                let actionLabel = payload.data;
                try {
                  const actionData = JSON.parse(payload.data);
                  actionLabel = actionData.label || payload.data;
                  // Update red dot overlay with click coordinates
                  if (actionData.x !== undefined && actionData.y !== undefined) {
                    setClickDot({ x: actionData.x, y: actionData.y });
                  }
                } catch {
                  // plain string action — no coordinates
                }
                agentText += (agentText ? "\n" : "") + `🎯 *${actionLabel}*`;
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === agentMsgId ? { ...m, content: agentText } : m
                  )
                );
                break;
              }

              case "ask_human":
                agentText += (agentText ? "\n\n" : "") + `❓ ${payload.data}`;
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === agentMsgId ? { ...m, content: agentText } : m
                  )
                );
                break;

              case "done":
                agentText += (agentText ? "\n\n" : "") + `✅ ${payload.data}`;
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === agentMsgId ? { ...m, content: agentText } : m
                  )
                );
                break;

              case "error":
                agentText += (agentText ? "\n\n" : "") + `❌ ${payload.data}`;
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === agentMsgId ? { ...m, content: agentText } : m
                  )
                );
                break;
            }
          } catch {
            // ignore malformed SSE
          }
        }
      }
    } catch (err) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === agentMsgId
            ? { ...m, content: "⚠️ Connection error. Please try again." }
            : m
        )
      );
    } finally {
      setIsStreaming(false);
    }
  }, [input, isStreaming, sessionId]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // Calculate red dot position relative to the displayed image
  const getClickDotStyle = (): React.CSSProperties | null => {
    if (!clickDot || !canvasImgRef.current) return null;

    const img = canvasImgRef.current;
    // The browser viewport is 1280x800 (Puppeteer default)
    const viewportW = 1280;
    const viewportH = 800;

    const pctX = (clickDot.x / viewportW) * 100;
    const pctY = (clickDot.y / viewportH) * 100;

    return {
      left: `${pctX}%`,
      top: `${pctY}%`,
    };
  };

  const dotStyle = getClickDotStyle();

  return (
    <div className="workspace">
      {/* ─── Sidebar ─── */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <img src="/logo.svg" alt="qaos" />
          <span>qaos</span>
        </div>
        <a href="/" className="new-chat-btn">+ New Chat</a>
        <nav className="session-list">
          {sessions.map((s: { id: string; title: string | null }) => (
            <div key={s.id} className="session-item-wrapper" style={{ position: "relative" }}>
              {editingSessionId === s.id ? (
                <Form method="post" className="w-full" onSubmit={() => setEditingSessionId(null)}>
                  <input type="hidden" name="sessionId" value={s.id} />
                  <input type="hidden" name="_action" value="rename" />
                  <input
                    type="text"
                    name="newTitle"
                    defaultValue={s.title || "New Chat"}
                    autoFocus
                    onBlur={(e) => {
                      if (e.target.form) e.target.form.requestSubmit();
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") setEditingSessionId(null);
                    }}
                    className="w-full bg-gray-800 text-white border border-gray-600 rounded px-2 py-1 text-sm outline-none focus:border-blue-500"
                    style={{ marginLeft: '10px', width: 'calc(100% - 20px)' }}
                  />
                </Form>
              ) : (
                <>
                  <NavLink
                    to={`/chat/${s.id}`}
                    className={({ isActive }) =>
                      `session-item${isActive ? " active" : ""}`
                    }
                    style={{ paddingRight: "50px" }}
                  >
                    {s.title || "New Chat"}
                  </NavLink>
                  <div style={{ position: "absolute", right: "5px", top: "50%", transform: "translateY(-50%)", zIndex: 10, display: "flex", gap: "4px" }}>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setEditingSessionId(s.id);
                      }}
                      className="edit-btn"
                      title="Rename Chat"
                      style={{ background: "transparent", border: "none", cursor: "pointer", opacity: 0.6, fontSize: "12px" }}
                    >
                      ✏️
                    </button>
                    <Form method="post" style={{ display: "inline" }}
                      onSubmit={(e) => {
                        if (!confirm("Are you sure you want to delete this chat?")) {
                          e.preventDefault();
                          e.stopPropagation();
                        }
                      }}
                    >
                      <input type="hidden" name="sessionId" value={s.id} />
                      <button 
                        type="submit" 
                        name="_action" 
                        value="delete"
                        className="delete-btn"
                        title="Delete Chat"
                        style={{ background: "transparent", border: "none", cursor: "pointer", opacity: 0.6, fontSize: "12px" }}
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
        <a href="/settings" className="sidebar-settings-link">⚙️ Settings</a>
        <div className="sidebar-footer">qaos Studio v1.0.0</div>
      </aside>

      {/* ─── Chat Panel ─── */}
      <div className="chat-panel">
        {messages.length > 0 && 
          <div className="chat-header">
            <span className="chat-header-title">{session.title}</span>
            <div className="flex justify-end gap-2 items-center">
            <div className="flex justify-end gap-2 items-center">
              {isStreaming && (
                <button
                  onClick={async () => {
                    await fetch(`/api/stop/${sessionId}`, { method: "POST" });
                  }}
                  className="px-2 py-1 bg-red-500/10 text-red-400 text-xs rounded hover:bg-red-500/20 transition-colors border border-red-500/20 cursor-pointer"
                >
                  ⏹ Stop
                </button>
              )}
              <span className="text-xs text-gray-400 font-mono ml-2">{activeModel}</span>
            </div>
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
        }
        <div className="chat-feed">
          {messages.length === 0 && (
            <div className="chat-empty flex flex-col items-center justify-center">
              <img
                src="/logo.svg"
                alt="qaos"
                width="64"
                height="64"
                className="w-16 h-16 mb-4 block"
              />
              <h2>qaos</h2>
              <p>Give me a URL and tell me what to test.</p>
            </div>
          )}
          {messages.map((msg) => (
            <div key={msg.id} className={`chat-bubble ${msg.role}`}>
              <div className="bubble-role">
                {msg.role === "user" ? (
                  "You"
                ) : (
                  <img
                    src="/logo.svg"
                    alt="qaos"
                    width="24"
                    height="24"
                    style={{ verticalAlign: "middle" }}
                  />
                )}
              </div>
              <div className={`bubble-content ${msg.excluded ? "excluded-msg" : ""}`}>
                {msg.content}
                {msg.excluded && <div className="excluded-badge">Excluded from Test</div>}
              </div>
              {msg.role === "user" && (
                <div className="bubble-actions">
                   <button 
                    onClick={async () => {
                      const newExcluded = !msg.excluded;
                      // Optimistic UI update
                      setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, excluded: newExcluded ? 1 : 0 } : m));
                      
                      await fetch("/api/message", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ messageId: msg.id, excluded: newExcluded })
                      });
                    }}
                    className="exclude-btn"
                    title={msg.excluded ? "Include in Replay" : "Exclude from Replay"}
                   >
                     {msg.excluded ? "Include in Replay" : "Exclude from Replay"}
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
            onChange={(e) => setInput(e.target.value)}
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
            {isStreaming ? "⏳" : "↑"}
          </button>
        </div>
      </div>

      {/* ─── Live Canvas (Hidden in forced Headed Mode) ─── */}
      {/* Canvas removed as per user request to use headed mode only */}
    </div>
  );
}
