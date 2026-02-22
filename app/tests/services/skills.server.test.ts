import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  loadSkillMetadata,
  loadSkillInstructions,
  formatSkillSummary,
} from '~/services/skills.server'
import fs from 'node:fs'

// Mock the node:fs module
vi.mock('node:fs')

describe('Skills Server Service', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    // In order for the cache logic to not interfere between tests,
    // we would ideally clear the `_cachedMetadata` but it's not exported.
    // However, `_cachedMetadata` caching is skipped if NODE_ENV !== "production".
    // Vitest runs in "test" env, so it should re-read every time.
  })

  describe('loadSkillMetadata', () => {
    it('should return empty array if SKILLS_DIR does not exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false)
      const metadata = loadSkillMetadata()
      expect(metadata).toEqual([])
    })

    it('should load valid skills and ignore invalid ones', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)

      // Mock readdirSync to return two directories
      vi.mocked(fs.readdirSync).mockReturnValue([
        { name: 'valid-skill', isDirectory: () => true },
        { name: 'invalid-skill', isDirectory: () => true },
        { name: 'not-a-dir', isDirectory: () => false },
      ] as any)

      // Mock readFileSync for frontmatter
      vi.mocked(fs.readFileSync).mockImplementation((pathPath: any) => {
        if (pathPath.includes('valid-skill')) {
          return '---\nname: valid-skill\ndescription: A valid skill\n---\nBody'
        }
        if (pathPath.includes('invalid-skill')) {
          // Missing name, so it should be skipped
          return '---\ndescription: Missing name\n---\nBody'
        }
        return ''
      })

      const metadata = loadSkillMetadata()
      expect(metadata.length).toBe(1)
      expect(metadata[0].name).toBe('valid-skill')
      expect(metadata[0].description).toBe('A valid skill')
    })
  })

  describe('loadSkillInstructions', () => {
    it('should return null if SKILL.md does not exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false)
      const instructions = loadSkillInstructions('any-skill')
      expect(instructions).toBeNull()
    })

    it('should parse and return the markdown body without frontmatter', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue(
        '---\nname: test-skill\ndescription: Test\n---\n# Step 1\nDo this.'
      )

      const instructions = loadSkillInstructions('test-skill')
      expect(instructions?.trim()).toBe('# Step 1\nDo this.')
    })
  })

  describe('formatSkillSummary', () => {
    it('should return empty string if no skills passed', () => {
      const summary = formatSkillSummary([])
      expect(summary).toBe('')
    })

    it('should format a JSON stringified summary of skills', () => {
      const summary = formatSkillSummary([
        { name: 'skill-one', description: 'Does one' },
        { name: 'skill-two', description: 'Does two', extra: 'ignore me' },
      ])
      expect(summary).toContain('Available Skills')
      expect(summary).toContain('skill-one')
      expect(summary).toContain('Does two')
      expect(summary).not.toContain('ignore me') // Ensures simplification
    })
  })
})
