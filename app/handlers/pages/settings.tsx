/**
 * Settings Page — System configuration
 *
 * API Keys and Model Selection.
 */

import { useState, useCallback } from 'react'
import { Form, useLoaderData, useActionData, useSubmit } from 'react-router'
import { eq, desc } from 'drizzle-orm'
import { NavLink } from 'react-router'
import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router'
import { requireUser, registerUser } from '~/services/auth.server'
import { getDb, schema } from '~/db/db.server'

function makeId(size = 12) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let id = ''
  for (let i = 0; i < size; i++) id += chars[Math.floor(Math.random() * chars.length)]
  return id
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function getConfig(db: Awaited<ReturnType<typeof getDb>>) {
  const rows = await db.select().from(schema.config)
  const map: Record<string, string> = {}
  for (const row of rows) {
    map[row.key] = row.value
  }
  return map
}

async function upsertConfig(db: Awaited<ReturnType<typeof getDb>>, key: string, value: string) {
  const existingRows = await db
    .select()
    .from(schema.config)
    .where(eq(schema.config.key, key))
    .limit(1)
  const existing = existingRows[0]
  if (existing) {
    await db.update(schema.config).set({ value }).where(eq(schema.config.key, key))
  } else {
    await db.insert(schema.config).values({ key, value })
  }
}

function maskKey(key: string): string {
  if (!key || key.length < 8) return key
  return key.slice(0, 4) + '•'.repeat(Math.min(key.length - 8, 20)) + key.slice(-4)
}

// ─── Models ─────────────────────────────────────────────────────────────────

const PROVIDERS = [
  {
    id: 'openai',
    name: 'OpenAI',
    keyName: 'openai_api_key',
    placeholder: 'sk-...',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'],
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    keyName: 'openrouter_api_key',
    placeholder: 'sk-or-...',
    models: [
      'openai/gpt-4o',
      'openai/gpt-4o-mini',
      'anthropic/claude-3.5-sonnet',
      'anthropic/claude-3-opus',
      'google/gemini-2.5-pro',
      'google/gemini-2.0-flash-001',
    ],
  },
]

// ─── Loader ─────────────────────────────────────────────────────────────────

export async function loader({ request }: LoaderFunctionArgs) {
  await requireUser(request)

  const db = await getDb()
  const cfg = await getConfig(db)

  // Fetch chat history for sidebar
  const sessions = await db.select().from(schema.tests).orderBy(desc(schema.tests.createdAt))

  const testAccounts = await db
    .select()
    .from(schema.testAccounts)
    .orderBy(desc(schema.testAccounts.createdAt))

  // Fetch user theme preference
  const user = await requireUser(request)
  const prefRows = await db
    .select()
    .from(schema.userPreferences)
    .where(eq(schema.userPreferences.userId, user.id))
    .limit(1)
  const theme = prefRows[0]?.theme ?? 'light'

  // Admin-only: Fetch all users
  const allUsers =
    user.role === 'admin'
      ? await db.select().from(schema.users).orderBy(desc(schema.users.createdAt))
      : []

  return {
    model: cfg.model ?? '',
    provider: cfg.provider ?? '',
    sessions,
    testAccounts,
    theme,
    user,
    allUsers,
  }
}

// ─── Action ─────────────────────────────────────────────────────────────────

export async function action({ request }: ActionFunctionArgs) {
  const user = await requireUser(request)

  const db = await getDb()
  const formData = await request.formData()
  const intent = formData.get('intent') as string

  if (intent === 'theme') {
    const theme = formData.get('theme') as string
    if (theme === 'light' || theme === 'dark') {
      const existingRows = await db
        .select()
        .from(schema.userPreferences)
        .where(eq(schema.userPreferences.userId, user.id))
        .limit(1)
      if (existingRows[0]) {
        await db
          .update(schema.userPreferences)
          .set({ theme })
          .where(eq(schema.userPreferences.id, existingRows[0].id))
      } else {
        await db.insert(schema.userPreferences).values({ userId: user.id, theme })
      }
      return { success: true, message: 'Theme updated.' }
    }
  }

  if (intent === 'model') {
    const provider = formData.get('provider') as string
    const model = formData.get('model') as string
    if (provider && model) {
      await upsertConfig(db, 'provider', provider)
      await upsertConfig(db, 'model', model)
    }
    return { success: true, message: 'Model updated.' }
  }

  if (intent === 'rename') {
    const targetSessionId = formData.get('sessionId') as string
    const newTitle = formData.get('newTitle') as string
    if (targetSessionId && newTitle) {
      await db
        .update(schema.tests)
        .set({ title: newTitle })
        .where(eq(schema.tests.id, targetSessionId))
      return { success: true, message: 'Test renamed.' }
    }
  }

  if (intent === 'delete') {
    const targetSessionId = formData.get('sessionId') as string
    if (targetSessionId) {
      await db.delete(schema.testMessages).where(eq(schema.testMessages.testId, targetSessionId))
      await db.delete(schema.tests).where(eq(schema.tests.id, targetSessionId))
      return { success: true, message: 'Test deleted.' }
    }
  }

  if (intent === 'add_test_account') {
    const label = (formData.get('label') as string)?.trim()
    const accountKeyRaw = (formData.get('accountKey') as string)?.trim()
    const username = (formData.get('username') as string)?.trim()
    const password = (formData.get('password') as string)?.trim()

    if (!label || !username || !password) {
      return { success: false, message: 'Label, username, and password are required.' }
    }

    const accountKey = accountKeyRaw || `acct_${makeId(8)}`

    const existing = await db
      .select()
      .from(schema.testAccounts)
      .where(eq(schema.testAccounts.accountKey, accountKey))
      .limit(1)

    if (existing[0]) {
      return { success: false, message: 'Account key already exists. Use a unique key.' }
    }

    await db.insert(schema.testAccounts).values({
      id: makeId(16),
      label,
      accountKey,
      username,
      password,
    })

    return { success: true, message: 'Test account added.' }
  }

  if (intent === 'delete_test_account') {
    const accountId = formData.get('accountId') as string
    if (!accountId) return { success: false, message: 'Missing account id.' }

    await db
      .update(schema.tests)
      .set({ testAccountId: null })
      .where(eq(schema.tests.testAccountId, accountId))

    await db.delete(schema.testAccounts).where(eq(schema.testAccounts.id, accountId))
    return { success: true, message: 'Test account deleted.' }
  }

  if (intent === 'add_user' && user.role === 'admin') {
    const email = (formData.get('email') as string)?.trim()
    const displayName = (formData.get('displayName') as string)?.trim()
    const password = formData.get('password') as string
    const role = (formData.get('role') as string) || 'user'

    if (!email || !displayName || !password) {
      return { success: false, message: 'All fields are required.' }
    }

    const res = await registerUser(email, displayName, password)
    if ('error' in res) {
      return { success: false, message: res.error }
    }

    // Update role if explicitly set to admin
    if (role === 'admin') {
      await db.update(schema.users).set({ role: 'admin' }).where(eq(schema.users.id, res.id))
    }

    return { success: true, message: `User ${email} created.` }
  }

  if (intent === 'delete_user' && user.role === 'admin') {
    const targetUserId = Number(formData.get('userId'))
    if (targetUserId === user.id) {
      return { success: false, message: 'Cannot delete yourself.' }
    }
    await db.delete(schema.users).where(eq(schema.users.id, targetUserId))
    return { success: true, message: 'User deleted.' }
  }

  return { success: false, message: 'Unknown action.' }
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function Settings() {
  const { model, provider, sessions, testAccounts, theme, user, allUsers } =
    useLoaderData<typeof loader>()
  const actionData = useActionData<typeof action>()
  const submit = useSubmit()

  const [editingSessionId, setEditingSessionId] = useState<string | null>(null)

  // Local state for provider/model to enable dynamic model list
  const [selectedProvider, setSelectedProvider] = useState(provider)
  const [selectedModel, setSelectedModel] = useState(model)
  const [selectedTheme, setSelectedTheme] = useState(theme)

  const currentProvider = PROVIDERS.find(p => p.id === selectedProvider) ?? PROVIDERS[0]

  // Auto-submit model on any change
  const submitModel = useCallback(
    (newProvider: string, newModel: string) => {
      const formData = new FormData()
      formData.set('intent', 'model')
      formData.set('provider', newProvider)
      formData.set('model', newModel)
      submit(formData, { method: 'post' })
    },
    [submit]
  )

  const submitTheme = useCallback(
    (newTheme: string) => {
      const formData = new FormData()
      formData.set('intent', 'theme')
      formData.set('theme', newTheme)
      submit(formData, { method: 'post' })
    },
    [submit]
  )

  const handleProviderChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const newProvider = e.target.value
      setSelectedProvider(newProvider)
      const providerInfo = PROVIDERS.find(p => p.id === newProvider) ?? PROVIDERS[0]
      const newModel = providerInfo.models[0]
      setSelectedModel(newModel)
      submitModel(newProvider, newModel)
    },
    [submitModel]
  )

  const handleModelChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const newModel = e.target.value
      setSelectedModel(newModel)
      submitModel(selectedProvider, newModel)
    },
    [submitModel, selectedProvider]
  )

  const handleThemeChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const newTheme = e.target.value
      setSelectedTheme(newTheme)
      submitTheme(newTheme)
    },
    [submitTheme]
  )

  return (
    <div className="settings-layout">
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
                  <input type="hidden" name="intent" value="rename" />
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
                        name="intent"
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
        <a href="/settings" className="sidebar-settings-link active">
          ⚙️ Settings
        </a>
        <div className="sidebar-footer">qaos Studio v0.1.0</div>
      </aside>

      {/* ─── Settings Content ─── */}
      <main className="settings-main">
        <h1 className="settings-title">⚙️ Settings</h1>

        {actionData?.message && (
          <div className={`settings-toast ${actionData.success ? 'success' : 'error'}`}>
            {actionData.message}
          </div>
        )}

        {/* ─── Appearance Selection ─── */}
        <section className="settings-card">
          <h2>Appearance</h2>
          <p className="settings-desc">Choose your preferred theme.</p>
          <Form method="post">
            <input type="hidden" name="intent" value="theme" />
            <div className="settings-row">
              <div className="settings-field">
                <label className="field-label">Theme</label>
                <select
                  name="theme"
                  value={selectedTheme}
                  onChange={handleThemeChange}
                  className="settings-select"
                >
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                </select>
              </div>
            </div>
          </Form>
        </section>

        {/* ─── Model Selection ─── */}
        <section className="settings-card">
          <h2>Model</h2>
          <p className="settings-desc">Select the LLM provider and model for the agent.</p>
          <Form method="post">
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
                  {PROVIDERS.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
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
                  {currentProvider.models.map(m => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </Form>
        </section>

        <section className="settings-card">
          <h2>Test Accounts</h2>
          <p className="settings-desc">
            Store reusable testing accounts. The LLM only sees account key/id, never raw values.
          </p>

          <Form method="post" className="space-y-2" style={{ marginBottom: '12px' }}>
            <input type="hidden" name="intent" value="add_test_account" />
            <div className="settings-row">
              <div className="settings-field">
                <label className="field-label">Label</label>
                <input
                  name="label"
                  className="settings-input"
                  placeholder="e.g. Admin User"
                  required
                />
              </div>
              <div className="settings-field">
                <label className="field-label">Account Key (ID)</label>
                <input
                  name="accountKey"
                  className="settings-input"
                  placeholder="e.g. admin_primary"
                />
              </div>
            </div>
            <div className="settings-row">
              <div className="settings-field">
                <label className="field-label">Username</label>
                <input name="username" className="settings-input" required />
              </div>
              <div className="settings-field">
                <label className="field-label">Password</label>
                <input name="password" className="settings-input" type="password" required />
              </div>
            </div>
            <button type="submit" className="settings-save-btn">
              Add Account
            </button>
          </Form>

          <div className="space-y-2">
            {testAccounts.length === 0 && (
              <p className="settings-desc">No test accounts configured yet.</p>
            )}
            {testAccounts.map(
              (account: { id: string; label: string; accountKey: string; username: string }) => (
                <div
                  key={account.id}
                  className="settings-row"
                  style={{
                    border: '1px solid var(--color-border)',
                    borderRadius: '8px',
                    padding: '10px',
                  }}
                >
                  <div className="settings-field">
                    <div className="field-label">{account.label}</div>
                    <div className="settings-desc">Key: {account.accountKey}</div>
                    <div className="settings-desc">Username: {account.username}</div>
                  </div>
                  <Form method="post">
                    <input type="hidden" name="intent" value="delete_test_account" />
                    <input type="hidden" name="accountId" value={account.id} />
                    <button
                      type="submit"
                      className="settings-save-btn"
                      style={{ background: '#ef4444' }}
                    >
                      Delete
                    </button>
                  </Form>
                </div>
              )
            )}
          </div>
        </section>

        {/* ─── User Management (Admin Only) ─── */}
        {user.role === 'admin' && (
          <section className="settings-card">
            <h2>User Management</h2>
            <p className="settings-desc">Manage admin and member users.</p>

            <Form method="post" className="space-y-2" style={{ marginBottom: '24px' }}>
              <input type="hidden" name="intent" value="add_user" />
              <div className="settings-row">
                <div className="settings-field">
                  <label className="field-label">Email</label>
                  <input name="email" className="settings-input" type="email" required />
                </div>
                <div className="settings-field">
                  <label className="field-label">Display Name</label>
                  <input name="displayName" className="settings-input" required />
                </div>
              </div>
              <div className="settings-row">
                <div className="settings-field">
                  <label className="field-label">Initial Password</label>
                  <input
                    name="password"
                    type="password"
                    className="settings-input"
                    required
                    placeholder="User's temporary password"
                  />
                </div>
                <div className="settings-field">
                  <label className="field-label">Role</label>
                  <select name="role" className="settings-select">
                    <option value="user">User</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
              </div>
              <button type="submit" className="settings-save-btn">
                Add User
              </button>
            </Form>

            <div className="space-y-2">
              <table
                className="w-full text-left"
                style={{ borderCollapse: 'separate', borderSpacing: '0 8px' }}
              >
                <thead>
                  <tr className="text-sm opacity-60">
                    <th>Name</th>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {allUsers.map((u: any) => (
                    <tr key={u.id}>
                      <td>{u.displayName}</td>
                      <td>{u.email}</td>
                      <td>
                        <span
                          style={{
                            padding: '2px 8px',
                            borderRadius: '4px',
                            fontSize: '11px',
                            background:
                              u.role === 'admin'
                                ? 'rgba(59, 130, 246, 0.2)'
                                : 'rgba(255,255,255,0.1)',
                            color: u.role === 'admin' ? '#60a5fa' : 'inherit',
                          }}
                        >
                          {u.role.toUpperCase()}
                        </span>
                      </td>
                      <td>
                        {u.id !== user.id ? (
                          <Form
                            method="post"
                            style={{ display: 'inline' }}
                            onSubmit={e => {
                              if (!confirm(`Delete user ${u.email}?`)) e.preventDefault()
                            }}
                          >
                            <input type="hidden" name="intent" value="delete_user" />
                            <input type="hidden" name="userId" value={u.id} />
                            <button
                              type="submit"
                              style={{
                                background: 'none',
                                border: 'none',
                                color: '#ef4444',
                                cursor: 'pointer',
                                fontSize: '12px',
                              }}
                            >
                              Delete
                            </button>
                          </Form>
                        ) : (
                          <span className="text-xs opacity-40">You</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </main>
    </div>
  )
}
