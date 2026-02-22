/**
 * Login Page — email/password authentication
 */

import { useState } from 'react'
import { Form, useActionData, Link } from 'react-router'
import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router'
import {
  authenticateUser,
  createSession,
  getSessionUser,
  setSessionCookie,
} from '~/services/auth.server'

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await getSessionUser(request)
  if (user) {
    throw new Response(null, { status: 302, headers: { Location: '/' } })
  }
  return {}
}

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData()
  const email = (formData.get('email') as string)?.trim()
  const password = formData.get('password') as string

  if (!email || !password) {
    return { error: 'Email and password are required.' }
  }

  const result = await authenticateUser(email, password)
  if ('error' in result) {
    return { error: result.error }
  }

  const token = await createSession(result.id, result.role)

  return new Response(null, {
    status: 302,
    headers: {
      Location: '/',
      'Set-Cookie': setSessionCookie(token),
    },
  })
}

export default function LoginPage() {
  const actionData = useActionData<typeof action>()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo">
          <img src="/logo.svg" alt="qaos" />
          <span>qaos</span>
        </div>
        <h1 className="auth-title">Sign In</h1>

        {actionData?.error && <div className="auth-error">{actionData.error}</div>}

        <Form method="post" className="auth-form">
          <div className="auth-field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              name="email"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              autoFocus
            />
          </div>
          <div className="auth-field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              name="password"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>
          <button type="submit" className="auth-submit">
            Sign In
          </button>
        </Form>

        <p className="auth-alt">
          Don&apos;t have an account? <Link to="/register">Create one</Link>
        </p>
      </div>
    </div>
  )
}
