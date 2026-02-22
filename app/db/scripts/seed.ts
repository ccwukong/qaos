import { Pool } from 'pg'
import 'dotenv/config'

async function main() {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error('DATABASE_URL is required for seeding')
  }

  const pool = new Pool({ connectionString })

  try {
    await pool.query(
      `INSERT INTO config (key, value)
       VALUES ('provider', 'openai')
       ON CONFLICT (key) DO NOTHING`
    )

    await pool.query(
      `INSERT INTO config (key, value)
       VALUES ('model', 'gpt-4o-mini')
       ON CONFLICT (key) DO NOTHING`
    )

    const seedAccount = process.env.SEED_TEST_ACCOUNT === 'true'
    if (seedAccount) {
      const label = process.env.SEED_TEST_ACCOUNT_LABEL || 'Default Test Account'
      const accountKey = process.env.SEED_TEST_ACCOUNT_KEY || 'default_test_account'
      const username = process.env.SEED_TEST_ACCOUNT_USERNAME || ''
      const password = process.env.SEED_TEST_ACCOUNT_PASSWORD || ''

      if (username && password) {
        await pool.query(
          `INSERT INTO test_accounts (id, label, account_key, username, password)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (account_key)
           DO UPDATE SET label = EXCLUDED.label, username = EXCLUDED.username, password = EXCLUDED.password`,
          [cryptoRandomId(), label, accountKey, username, password]
        )
      }
    }

    console.log('[seed] complete')
  } finally {
    await pool.end()
  }
}

function cryptoRandomId(length = 16): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let out = ''
  for (let i = 0; i < length; i++) {
    out += chars[Math.floor(Math.random() * chars.length)]
  }
  return out
}

main().catch(err => {
  console.error('[seed] failed:', err)
  process.exit(1)
})
