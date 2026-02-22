/**
 * Skill Loader Service — reads skill metadata and instructions from .qaos/skills/
 *
 * Implements Agent Skills specification (https://agentskills.io/specification):
 * - Metadata: YAML frontmatter in SKILL.md
 * - Instructions: SKILL.md body
 * - Schemas: assets/*.json
 */

import fs from 'node:fs'
import path from 'node:path'
import fm from 'front-matter'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SkillMetadata {
  name: string
  description: string
  [key: string]: unknown
}

export interface SkillContent {
  attributes: SkillMetadata
  body: string
}

// ─── Paths ──────────────────────────────────────────────────────────────────

const SKILLS_DIR = path.join(process.cwd(), 'skills')

// ─── Metadata Loader (progressive disclosure) ──────────────────────────────

let _cachedMetadata: SkillMetadata[] | null = null

/**
 * Load metadata from SKILL.md frontmatter for every skill directory.
 * Results are cached after first call for the process lifetime (in prod).
 */
export function loadSkillMetadata(): SkillMetadata[] {
  // Only cache in production
  if (process.env.NODE_ENV === 'production' && _cachedMetadata) return _cachedMetadata

  const skills: SkillMetadata[] = []

  if (!fs.existsSync(SKILLS_DIR)) {
    _cachedMetadata = skills
    return skills
  }

  const entries = fs.readdirSync(SKILLS_DIR, { withFileTypes: true })

  for (const entry of entries) {
    if (!entry.isDirectory()) continue

    const skillPath = path.join(SKILLS_DIR, entry.name, 'SKILL.md')
    if (!fs.existsSync(skillPath)) continue

    try {
      const raw = fs.readFileSync(skillPath, 'utf-8')
      const parsed = fm<SkillMetadata>(raw)

      // Validate required fields
      if (!parsed.attributes.name || !parsed.attributes.description) {
        console.warn(`[Skills] Skipping ${entry.name}: Missing name or description in frontmatter.`)
        continue
      }

      // Guardrail: Strict Name Check
      // The frontmatter 'name' MUST match the directory name (kebab-case)
      if (parsed.attributes.name !== entry.name) {
        console.warn(
          `[Skills] Skipping ${entry.name}: Frontmatter name '${parsed.attributes.name}' does not match directory name '${entry.name}'.`
        )
        continue
      }

      skills.push(parsed.attributes)
    } catch (err) {
      console.warn(`[Skills] Failed to parse SKILL.md for skill: ${entry.name}`, err)
    }
  }

  _cachedMetadata = skills
  console.log(`[Skills] Loaded ${skills.length} skill(s): ${skills.map(s => s.name).join(', ')}`)
  return skills
}

// ─── Dynamic Instruction Loader ─────────────────────────────────────────────

/**
 * Load the full SKILL.md instructions for a specific skill by name.
 * Returns only the markdown body (stripping frontmatter).
 */
export function loadSkillInstructions(skillName: string): string | null {
  const skillDir = path.join(SKILLS_DIR, skillName)
  const skillPath = path.join(skillDir, 'SKILL.md')

  if (!fs.existsSync(skillPath)) {
    console.warn(`[Skills] SKILL.md not found for: ${skillName}`)
    return null
  }

  try {
    const raw = fs.readFileSync(skillPath, 'utf-8')
    const parsed = fm<SkillMetadata>(raw)
    console.log(`[Skills] Loaded instructions for: ${skillName} (${parsed.body.length} chars)`)
    return parsed.body
  } catch {
    console.warn(`[Skills] Failed to read SKILL.md for: ${skillName}`)
    return null
  }
}

export function formatSkillSummary(skills: SkillMetadata[]): string {
  if (skills.length === 0) return ''

  const simplifiedSkills = skills.map(s => ({
    name: s.name,
    description: s.description,
  }))

  return [
    '## Available Skills',
    'You can invoke these skills when the situation matches their description and trigger conditions.',
    'Do NOT use a skill if your task matches one of its negative triggers.',
    'To use a skill, include a `use_skill` action with the skill name.',
    '',
    '```json',
    JSON.stringify(simplifiedSkills, null, 2),
    '```',
    '',
    'If no skill matches the request (or if the request hits a negative trigger), you must Refuse or Ask Human.',
  ].join('\n')
}

/**
 * Retrieve the JSON schema for a specific tool in a skill.
 * Looks for .qaos/skills/<skillName>/assets/<toolName>.json
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getSkillToolSchema(
  skillName: string,
  toolName: string
): Record<string, any> | null {
  const schemaPath = path.join(SKILLS_DIR, skillName, 'assets', `${toolName}.json`)

  if (!fs.existsSync(schemaPath)) {
    return null
  }

  try {
    const raw = fs.readFileSync(schemaPath, 'utf-8')
    return JSON.parse(raw)
  } catch (err) {
    console.warn(`[Skills] Failed to parse schema for tool ${toolName} in skill ${skillName}`, err)
    return null
  }
}

/**
 * Dynamically imports and executes a validation script from the skill's scripts/ directory.
 * @param skillName The name of the skill
 * @returns { valid: boolean; error?: string }
 */
export async function executeSkillValidation(
  skillName: string
): Promise<{ valid: boolean; error?: string }> {
  const scriptPath = path.join(SKILLS_DIR, skillName, 'scripts', 'validate.ts')

  if (!fs.existsSync(scriptPath)) {
    // No validation script = auto-pass
    return { valid: true }
  }

  try {
    console.log(`[Tripwire] Validating ${skillName} prerequisites...`)
    // Dynamic import
    const module = await import(/* @vite-ignore */ scriptPath + '?t=' + Date.now()) // cache bust

    if (typeof module.default === 'function') {
      const result = await module.default()
      if (typeof result === 'boolean') {
        return { valid: result, error: result ? undefined : 'Validation failed silently' }
      }
      return result // returning { valid, error } object
    }

    return { valid: true }
  } catch (error) {
    console.error(`[Tripwire] Error executing validation for ${skillName}:`, error)
    return { valid: false, error: 'Validation script threw an unexpected error.' } // Fail safe
  }
}

/**
 * Execute a general purpose script for a skill.
 */
export async function executeSkillScript(
  skillName: string,
  scriptName: string,
  args: Record<string, any>
): Promise<{ output: any; error?: string }> {
  const scriptPath = path.join(SKILLS_DIR, skillName, 'scripts', scriptName)
  // Support both .ts and .js? sticking to .ts for now as per user context
  // logic needs to handle file extension if not provided
  const fullPath = scriptPath.endsWith('.ts') ? scriptPath : `${scriptPath}.ts`

  if (!fs.existsSync(fullPath)) {
    return { output: null, error: `Script not found: ${scriptName}` }
  }

  try {
    const module = await import(/* @vite-ignore */ fullPath)
    if (typeof module.default !== 'function') {
      return { output: null, error: 'Script does not export a default function' }
    }
    const result = await module.default(args)
    return { output: result }
  } catch (err) {
    return { output: null, error: String(err) }
  }
}
