import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  hashPassword,
  verifyPassword,
  createSession,
  getSessionUser,
  registerUser,
  authenticateUser,
  requireAdmin,
} from '~/services/auth.server'
import { getDb, schema } from '~/db/db.server'
import { eq } from 'drizzle-orm'

describe('Auth Server Service (JWT & RBAC)', () => {
  beforeEach(async () => {
    const db = await getDb()
    // Clean up users for each test
    await db.delete(schema.users)
  })

  it('hashes and verifies passwords correctly', async () => {
    const password = 'secret-password'
    const hash = await hashPassword(password)
    expect(hash).not.toBe(password)
    expect(await verifyPassword(password, hash)).toBe(true)
    expect(await verifyPassword('wrong', hash)).toBe(false)
  })

  it('registers the first user as admin and others as user', async () => {
    const res1 = await registerUser('admin@test.com', 'Admin', 'password123')
    if ('error' in res1) throw new Error(res1.error)
    expect(res1.role).toBe('admin')

    const res2 = await registerUser('user@test.com', 'User', 'password123')
    if ('error' in res2) throw new Error(res2.error)
    expect(res2.role).toBe('user')
  })

  it('creates and verifies a JWT session', async () => {
    const user = await registerUser('test@test.com', 'Tester', 'password123')
    if ('error' in user) throw new Error(user.error)

    const token = await createSession(user.id, user.role)
    expect(typeof token).toBe('string')

    const request = new Request('http://localhost', {
      headers: { Cookie: `qaos_session=${token}` },
    })

    const sessionUser = await getSessionUser(request)
    expect(sessionUser).not.toBeNull()
    expect(sessionUser?.email).toBe('test@test.com')
    expect(sessionUser?.role).toBe('admin') // First user is admin
  })

  it('authenticates valid users', async () => {
    await registerUser('test@test.com', 'Tester', 'password123')

    const result = await authenticateUser('test@test.com', 'password123')
    if ('error' in result) throw new Error(result.error)
    expect(result.email).toBe('test@test.com')
    expect(result.role).toBe('admin')

    const fail = await authenticateUser('test@test.com', 'wrong')
    expect('error' in fail).toBe(true)
  })

  it('enforces requireAdmin guard', async () => {
    // 1. Admin case
    const admin = await registerUser('admin@test.com', 'Admin', 'password123')
    if ('error' in admin) throw new Error(admin.error)
    const adminToken = await createSession(admin.id, admin.role)
    const adminReq = new Request('http://localhost', {
      headers: { Cookie: `qaos_session=${adminToken}` },
    })
    const adminResult = await requireAdmin(adminReq)
    expect(adminResult.role).toBe('admin')

    // 2. User case
    const user = await registerUser('user@test.com', 'User', 'password123')
    if ('error' in user) throw new Error(user.error)
    const userToken = await createSession(user.id, user.role)
    const userReq = new Request('http://localhost', {
      headers: { Cookie: `qaos_session=${userToken}` },
    })

    try {
      await requireAdmin(userReq)
      throw new Error('Should have thrown 403')
    } catch (e: any) {
      if (e instanceof Response) {
        expect(e.status).toBe(403)
      } else {
        throw e
      }
    }
  })
})
