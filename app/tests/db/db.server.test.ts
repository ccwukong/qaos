import { describe, it, expect, vi, beforeEach } from 'vitest'

const queryMock = vi.fn(async () => ({}))
const poolCtorMock = vi.fn()

vi.mock('pg', () => ({
  Pool: class MockPool {
    constructor(options?: unknown) {
      poolCtorMock(options)
    }

    query = queryMock
    end = vi.fn(async () => undefined)
  },
}))

vi.mock('drizzle-orm/node-postgres', () => ({
  drizzle: vi.fn(() => ({ id: 'mock-drizzle-pg' })),
}))

// We can mock process.env, but we need to do it carefully
const originalEnv = process.env

describe('Database Server Service', () => {
  beforeEach(async () => {
    vi.resetModules()
    vi.resetAllMocks()
    queryMock.mockClear()
    poolCtorMock.mockClear()
    process.env = { ...originalEnv }
  })

  it('returns a db instance when DATABASE_URL is PostgreSQL', async () => {
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db'
    const dbModule = await import('~/db/db.server')
    const db = await dbModule.getDb()

    expect(db).toBeDefined()
    expect(queryMock).toHaveBeenCalled()
  })

  it('returns the same singleton db instance', async () => {
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db'
    const dbModule = await import('~/db/db.server')
    const db1 = await dbModule.getDb()
    const db2 = await dbModule.getDb()

    expect(db1).toBe(db2)
  })

  it("falls back from docker host 'db' to localhost outside Docker", async () => {
    process.env.DATABASE_URL = 'postgresql://user:pass@db:5432/db'
    delete process.env.QAOS_RUNNING_IN_DOCKER

    const dbModule = await import('~/db/db.server')
    await dbModule.getDb()

    expect(poolCtorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionString: 'postgresql://user:pass@localhost:5432/db',
      })
    )
  })
})
