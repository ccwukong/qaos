/**
 * Register Page — create a new user account
 */

import { useState } from 'react'
import { Form, useActionData, Link } from 'react-router'
import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router'
import {
  registerUser,
  createSession,
  getSessionUser,
  setSessionCookie,
} from '~/services/auth.server'

export async function loader({ request }: LoaderFunctionArgs) {
  // Public registration is disabled. Redirect to login.
  return new Response(null, {
    status: 302,
    headers: { Location: '/login?error=Registration is restricted to administrators' },
  })
}

export async function action() {
  return new Response('Registration disabled', { status: 403 })
}

export default function RegisterPage() {
  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo">
          <img src="/logo.svg" alt="qaos" />
          <span>qaos</span>
        </div>
        <h1 className="auth-title">Registration Disabled</h1>
        <p className="auth-alt" style={{ marginTop: '20px' }}>
          Please contact your administrator to create an account.
        </p>
        <p className="auth-alt">
          <Link to="/login">Return to Sign In</Link>
        </p>
      </div>
    </div>
  )
}
