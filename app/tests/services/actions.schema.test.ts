import { describe, it, expect } from 'vitest'
import { ActionSchema, getActionDescriptions } from '~/services/actions.schema'

describe('ActionSchema', () => {
  it('should validate a valid navigate action', () => {
    const payload = {
      action: 'navigate',
      url: 'https://example.com',
      reasoning: 'To start testing',
    }
    const result = ActionSchema.safeParse(payload)
    expect(result.success).toBe(true)
  })

  it('should invalidate an invalid navigate action (missing url)', () => {
    const payload = {
      action: 'navigate',
      reasoning: 'To start testing',
    }
    const result = ActionSchema.safeParse(payload)
    expect(result.success).toBe(false)
  })

  it('should validate a click action with coordinates', () => {
    const payload = {
      action: 'click',
      x: 100,
      y: 200,
      reasoning: 'Clicking login button',
    }
    const result = ActionSchema.safeParse(payload)
    expect(result.success).toBe(true)
  })

  it('should invalidate a click action missing coordinates', () => {
    const payload = {
      action: 'click',
      reasoning: 'Clicking login button',
    }
    const result = ActionSchema.safeParse(payload)
    expect(result.success).toBe(false)
  })

  it('should validate a type_secret action', () => {
    const payload = {
      action: 'type_secret',
      key: 'TEST_USER',
      x: 50,
      y: 50,
      reasoning: 'Entering username',
    }
    const result = ActionSchema.safeParse(payload)
    expect(result.success).toBe(true)
  })

  it('should validate a use_skill action', () => {
    const payload = {
      action: 'use_skill',
      skill_name: 'standard-login',
      reasoning: 'User asked to log in',
    }
    const result = ActionSchema.safeParse(payload)
    expect(result.success).toBe(true)
  })

  it('should fail validation for an unknown action', () => {
    const payload = {
      action: 'unknown_magic',
      reasoning: 'Because I am AI',
    }
    const result = ActionSchema.safeParse(payload)
    expect(result.success).toBe(false)
  })
})

describe('getActionDescriptions', () => {
  it('should return a string containing all action types', () => {
    const text = getActionDescriptions()
    expect(text).toContain('navigate')
    expect(text).toContain('click')
    expect(text).toContain('type')
    expect(text).toContain('scroll')
    expect(text).toContain('ask_human')
    expect(text).toContain('done')
    expect(text).toContain('error')
    expect(text).toContain('use_skill')
    expect(text).toContain('type_secret')
    expect(text).toContain('run_script')
  })
})
