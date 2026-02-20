/**
 * Settings Page — System configuration
 *
 * Theme (Light / Dark / System), API Keys, Model Selection
 * Theme and Model auto-save on change — no explicit Save buttons.
 */

import { useState, useRef, useCallback } from "react";
import { Form, useLoaderData, useActionData, useSubmit } from "react-router";
import type { Route } from "./+types/settings";
import { getDb, schema } from "~/db/db.server";
import { eq, desc } from "drizzle-orm";
import { NavLink } from "react-router";

// ─── Helpers ────────────────────────────────────────────────────────────────

function getConfig(db: ReturnType<typeof getDb>) {
  const rows = db.select().from(schema.config).all();
  const map: Record<string, string> = {};
  for (const row of rows) {
    map[row.key] = row.value;
  }
  return map;
}

function upsertConfig(db: ReturnType<typeof getDb>, key: string, value: string) {
  const existing = db.select().from(schema.config).where(eq(schema.config.key, key)).get();
  if (existing) {
    db.update(schema.config).set({ value }).where(eq(schema.config.key, key)).run();
  } else {
    db.insert(schema.config).values({ key, value }).run();
  }
}

function maskKey(key: string): string {
  if (!key || key.length < 8) return key;
  return key.slice(0, 4) + "•".repeat(Math.min(key.length - 8, 20)) + key.slice(-4);
}

// ─── Models ─────────────────────────────────────────────────────────────────

const PROVIDERS = [
  {
    id: "openai",
    name: "OpenAI",
    keyName: "openai_api_key",
    placeholder: "sk-...",
    models: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo"],
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    keyName: "openrouter_api_key",
    placeholder: "sk-or-...",
    models: [
      "openai/gpt-4o",
      "openai/gpt-4o-mini",
      "anthropic/claude-3.5-sonnet",
      "anthropic/claude-3-opus",
      "google/gemini-2.5-pro",
      "google/gemini-2.0-flash-001",
    ],
  },
];

// ─── Loader ─────────────────────────────────────────────────────────────────

export async function loader() {
  const db = getDb();
  const cfg = getConfig(db);

  // Fetch chat history for sidebar
  const sessions = db
    .select()
    .from(schema.sessions)
    .orderBy(desc(schema.sessions.createdAt))
    .all();

  return {
    theme: cfg.theme ?? "light",
    model: cfg.model ?? "",
    provider: cfg.provider ?? "",
    sessions,
  };
}

// ─── Action ─────────────────────────────────────────────────────────────────

export async function action({ request }: Route.ActionArgs) {
  const db = getDb();
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "theme") {
    const theme = formData.get("theme") as string;
    if (["light", "dark", "system"].includes(theme)) {
      upsertConfig(db, "theme", theme);
      // Return JSON with Set-Cookie header (no redirect — client applies instantly)
      return new Response(JSON.stringify({ success: true, message: "Theme updated." }), {
        headers: {
          "Content-Type": "application/json",
          "Set-Cookie": `qaos-theme=${theme}; Path=/; Max-Age=31536000; SameSite=Lax`,
        },
      });
    }
    return { success: true, message: "Theme updated." };
  }

  if (intent === "model") {
    const provider = formData.get("provider") as string;
    const model = formData.get("model") as string;
    if (provider && model) {
      upsertConfig(db, "provider", provider);
      upsertConfig(db, "model", model);
    }
    return { success: true, message: "Model updated." };
  }

  if (intent === "rename") {
    const targetSessionId = formData.get("sessionId") as string;
    const newTitle = formData.get("newTitle") as string;
    if (targetSessionId && newTitle) {
      await db.update(schema.sessions)
        .set({ title: newTitle })
        .where(eq(schema.sessions.id, targetSessionId));
      return { success: true, message: "Chat renamed." };
    }
  }

  if (intent === "delete") {
    const targetSessionId = formData.get("sessionId") as string;
    if (targetSessionId) {
      await db.delete(schema.messages).where(eq(schema.messages.sessionId, targetSessionId));
      await db.delete(schema.sessions).where(eq(schema.sessions.id, targetSessionId));
      return { success: true, message: "Chat deleted." };
    }
  }

  return { success: false, message: "Unknown action." };
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function Settings() {
  const { theme, model, provider, sessions } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();

  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);

  // Local state for provider/model to enable dynamic model list
  const [selectedProvider, setSelectedProvider] = useState(provider);
  const [selectedModel, setSelectedModel] = useState(model);
  const [activeTheme, setActiveTheme] = useState(theme);

  const currentProvider = PROVIDERS.find((p) => p.id === selectedProvider) ?? PROVIDERS[0];

  const themeFormRef = useRef<HTMLFormElement>(null);
  const modelFormRef = useRef<HTMLFormElement>(null);

  // Apply theme immediately on click, then save in background
  const handleThemeChange = useCallback(
    (newTheme: string) => {
      // 1. Instantly apply on the client
      setActiveTheme(newTheme);
      const resolved =
        newTheme === "system"
          ? window.matchMedia("(prefers-color-scheme: dark)").matches
            ? "dark"
            : "light"
          : newTheme;
      document.documentElement.setAttribute("data-theme", resolved);
      document.cookie = `qaos-theme=${newTheme}; path=/; max-age=31536000; samesite=lax`;

      // 2. Persist to DB in background (no navigation)
      const formData = new FormData();
      formData.set("intent", "theme");
      formData.set("theme", newTheme);
      submit(formData, { method: "post", navigate: false });
    },
    [submit]
  );

  // Auto-submit model on any change
  const submitModel = useCallback(
    (newProvider: string, newModel: string) => {
      const formData = new FormData();
      formData.set("intent", "model");
      formData.set("provider", newProvider);
      formData.set("model", newModel);
      submit(formData, { method: "post" });
    },
    [submit]
  );

  const handleProviderChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const newProvider = e.target.value;
      setSelectedProvider(newProvider);
      const providerInfo = PROVIDERS.find((p) => p.id === newProvider) ?? PROVIDERS[0];
      const newModel = providerInfo.models[0];
      setSelectedModel(newModel);
      submitModel(newProvider, newModel);
    },
    [submitModel]
  );

  const handleModelChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const newModel = e.target.value;
      setSelectedModel(newModel);
      submitModel(selectedProvider, newModel);
    },
    [submitModel, selectedProvider]
  );

  return (
    <div className="settings-layout">
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
                  <input type="hidden" name="intent" value="rename" />
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
                        name="intent" 
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
        <a href="/settings" className="sidebar-settings-link active">⚙️ Settings</a>
        <div className="sidebar-footer">qaos Studio v0.1.0</div>
      </aside>

      {/* ─── Settings Content ─── */}
      <main className="settings-main">
        <h1 className="settings-title">⚙️ Settings</h1>

        {actionData?.message && (
          <div className={`settings-toast ${actionData.success ? "success" : "error"}`}>
            {actionData.message}
          </div>
        )}

        {/* ─── Theme ─── */}
        <section className="settings-card">
          <h2>Appearance</h2>
          <p className="settings-desc">Choose your preferred theme.</p>
          <Form method="post" ref={themeFormRef}>
            <input type="hidden" name="intent" value="theme" />
            <div className="theme-picker">
              {(["light", "dark", "system"] as const).map((t) => (
                <label key={t} className={`theme-option${activeTheme === t ? " active" : ""}`}>
                  <input
                    type="radio"
                    name="theme"
                    value={t}
                    checked={activeTheme === t}
                    onChange={() => handleThemeChange(t)}
                  />
                  <span className="theme-icon">
                    {t === "light" ? "☀️" : t === "dark" ? "🌙" : "💻"}
                  </span>
                  <span className="theme-label">{t.charAt(0).toUpperCase() + t.slice(1)}</span>
                </label>
              ))}
            </div>
          </Form>
        </section>

        {/* ─── Model Selection ─── */}
        <section className="settings-card">
          <h2>Model</h2>
          <p className="settings-desc">Select the LLM provider and model for the agent.</p>
          <Form method="post" ref={modelFormRef}>
            <input type="hidden" name="intent" value="model" />
            <div className="settings-row">
              <div className="settings-field">
                <label className="field-label">Provider</label>
                <select
                  name="provider"
                  value={selectedProvider}
                  onChange={handleProviderChange}
                  className="settings-select"
                >
                  {PROVIDERS.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div className="settings-field">
                <label className="field-label">Model</label>
                <select
                  name="model"
                  value={selectedModel}
                  onChange={handleModelChange}
                  className="settings-select"
                >
                  {currentProvider.models.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
            </div>
          </Form>
        </section>
      </main>
    </div>
  );
}
