import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getLocalExecutorStatus,
  markLocalExecutorConnected,
  markLocalExecutorDisconnected,
  resetLocalExecutorStatus,
  touchLocalExecutorHeartbeat,
} from '~/services/local-executor-registry.server'

describe('Local Executor Registry', () => {
  beforeEach(() => {
    resetLocalExecutorStatus()
    vi.useRealTimers()
  })

  it('starts disconnected', () => {
    const status = getLocalExecutorStatus()
    expect(status.connected).toBe(false)
    expect(status.lastSeenAt).toBeNull()
  })

  it('marks connected with timestamp', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-21T00:00:00.000Z'))

    markLocalExecutorConnected()

    const status = getLocalExecutorStatus()
    expect(status.connected).toBe(true)
    expect(status.lastSeenAt).toBe(new Date('2026-02-21T00:00:00.000Z').getTime())
  })

  it('updates heartbeat timestamp', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-21T00:00:00.000Z'))
    touchLocalExecutorHeartbeat()

    vi.setSystemTime(new Date('2026-02-21T00:00:05.000Z'))
    touchLocalExecutorHeartbeat()

    const status = getLocalExecutorStatus()
    expect(status.connected).toBe(true)
    expect(status.lastSeenAt).toBe(new Date('2026-02-21T00:00:05.000Z').getTime())
  })

  it('marks disconnected but keeps last seen timestamp', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-21T00:00:00.000Z'))
    markLocalExecutorConnected()

    markLocalExecutorDisconnected()

    const status = getLocalExecutorStatus()
    expect(status.connected).toBe(false)
    expect(status.lastSeenAt).toBe(new Date('2026-02-21T00:00:00.000Z').getTime())
  })
})
