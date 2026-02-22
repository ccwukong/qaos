/**
 * Authentication service — JWT-based stateless sessions with scrypt password hashing.
 *
 * Uses 'jose' for JWT signing/verification.
 */

import crypto from 'node:crypto'
import { SignJWT, jwtVerify } from 'jose'
import { getDb, schema } from '~/db/db.server'
import { eq, count } from 'drizzle-orm'

const SESSION_COOKIE = 'qaos_session'
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

// In production, this MUST be set in environment variables.
const JWT_SECRET = new TextEncoder().encode(
  process.env.QAOS_JWT_SECRET || 'qaos-default-dev-secret-change-me-in-prod'
)

// ─── Password Hashing ──────────────────────────────────────────────────────

export function hashPassword(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString('hex')
    crypto.scrypt(password, salt, 64, (err, derived) => {
      if (err) return reject(err)
      resolve(`${salt}:${derived.toString('hex')}`)
    })
  })
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const [salt, key] = hash.split(':')
    crypto.scrypt(password, salt, 64, (err, derived) => {
      if (err) return reject(err)
      resolve(crypto.timingSafeEqual(Buffer.from(key, 'hex'), derived))
    })
  })
}

// ─── JWT Session Management ──────────────────────────────────────────────────

export async function createSession(userId: number, role: string): Promise<string> {
  const jwt = await new SignJWT({ userId, role })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(JWT_SECRET)

  return jwt
}

export async function getSessionUser(
  request: Request
): Promise<{ id: number; email: string; displayName: string; role: string } | null> {
  const cookieHeader = request.headers.get('Cookie')
  if (!cookieHeader) return null

  const token = parseCookie(cookieHeader, SESSION_COOKIE)
  if (!token) return null

  try {
    const { payload } = await jwtVerify(token, JWT_SECRET)
    const userId = payload.userId as number

    const db = await getDb()
    const userRows = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1)

    const user = userRows[0]
    if (!user) return null

    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
    }
  } catch (err) {
    // JWT verification failed or user not found
    return null
  }
}

export async function destroySession(_request: Request): Promise<void> {
  // Stateless JWT sessions don't need server-side destruction.
  // The cookie is cleared on the client.
}

export function setSessionCookie(token: string): string {
  const maxAge = Math.floor(SESSION_MAX_AGE_MS / 1000)
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
}

// ─── User Registration & Auth ────────────────────────────────────────────────

export async function registerUser(
  email: string,
  displayName: string,
  password: string
): Promise<{ id: number; email: string; displayName: string; role: string } | { error: string }> {
  const db = await getDb()

  const existing = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .limit(1)

  if (existing[0]) {
    return { error: 'Email already registered.' }
  }

  // RBAC: First user to register becomes admin
  const userCountResult = await db.select({ val: count() }).from(schema.users)
  const isFirstUser = userCountResult[0].val === 0
  const role = isFirstUser ? 'admin' : 'user'

  const passwordHash = await hashPassword(password)
  const rows = await db
    .insert(schema.users)
    .values({ email, displayName, passwordHash, role })
    .returning({
      id: schema.users.id,
      email: schema.users.email,
      displayName: schema.users.displayName,
      role: schema.users.role,
    })

  return rows[0]
}

export async function authenticateUser(
  email: string,
  password: string
): Promise<{ id: number; email: string; displayName: string; role: string } | { error: string }> {
  const db = await getDb()

  const rows = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1)
  const user = rows[0]

  if (!user) {
    return { error: 'Invalid email or password.' }
  }

  const valid = await verifyPassword(password, user.passwordHash)
  if (!valid) {
    return { error: 'Invalid email or password.' }
  }

  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
  }
}

// ─── Auth Guards ─────────────────────────────────────────────────────────────

export async function requireUser(request: Request) {
  const user = await getSessionUser(request)
  if (!user) {
    throw new Response(null, {
      status: 302,
      headers: { Location: '/login' },
    })
  }
  return user
}

export async function requireAdmin(request: Request) {
  const user = await requireUser(request)
  if (user.role !== 'admin') {
    throw new Response('Forbidden: Admin access required', { status: 403 })
  }
  return user
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function parseCookie(cookieHeader: string, name: string): string | null {
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : null
}
