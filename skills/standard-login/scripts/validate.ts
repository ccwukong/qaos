/**
 * Validation script for standard-login skill.
 *
 * This script runs BEFORE the agent is allowed to execute the skill instructions.
 * It verifies that at least one test account exists in the database.
 *
 * Returns:
 * - true: Validation passed
 * - false: Validation failed (skill execution will be blocked)
 */

import 'dotenv/config'
import { Pool } from 'pg'

export default async function validate(): Promise<{ valid: boolean; error?: string }> {
  console.log('[Tripwire] Validating standard-login prerequisites...')

  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    return { valid: false, error: 'DATABASE_URL is missing.' }
  }

  const pool = new Pool({ connectionString })
  try {
    const result = await pool.query('SELECT COUNT(*)::int AS total FROM test_accounts')
    const total = result.rows[0]?.total ?? 0
    if (total < 1) {
      return {
        valid: false,
        error: 'No test accounts found. Add one in Settings -> Test Accounts.',
      }
    }
  } catch (error) {
    console.error('[Tripwire] FAILED: DB validation error', error)
    return { valid: false, error: 'Failed to verify test accounts from database.' }
  } finally {
    await pool.end()
  }

  console.log('[Tripwire] Validation passed for standard-login.')
  return { valid: true }
}
