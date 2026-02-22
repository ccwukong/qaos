import { describe, it, expect, beforeEach } from 'vitest'
import { getExecutionAdapter, resolveExecutionMode } from '~/services/executor-router.server'
import { qaosConfig } from '../../../qaos.config'

const originalMode = qaosConfig.deploymentMode

describe('Executor Router Service', () => {
  beforeEach(() => {
    qaosConfig.deploymentMode = originalMode
  })

  it('defaults to single mode when no mode is configured', () => {
    qaosConfig.deploymentMode = 'single'
    expect(resolveExecutionMode()).toBe('single')
  })

  it('uses qaos config mode when valid', () => {
    qaosConfig.deploymentMode = 'hybrid'
    expect(resolveExecutionMode()).toBe('hybrid')
  })

  it('maps legacy server value to single', () => {
    // compatibility guard
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(qaosConfig as any).deploymentMode = 'server'
    expect(resolveExecutionMode()).toBe('single')
  })

  it('maps legacy local value to hybrid', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(qaosConfig as any).deploymentMode = 'local'
    expect(resolveExecutionMode()).toBe('hybrid')
  })

  it('returns a usable adapter object', () => {
    const adapter = getExecutionAdapter()
    expect(adapter).toBeDefined()
    expect(typeof adapter.getPage).toBe('function')
    expect(typeof adapter.executeAction).toBe('function')
  })

  it('returns local adapter behavior when hybrid mode is selected', async () => {
    qaosConfig.deploymentMode = 'hybrid'
    const adapter = getExecutionAdapter()
    await expect(adapter.getPage('session-1', 'http://example.com')).rejects.toThrow(
      /Hybrid execution mode is selected/
    )
  })
})
