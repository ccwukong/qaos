import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { Pool } from 'pg'
import 'dotenv/config'

function hashSql(sql: string): string {
  return crypto.createHash('sha256').update(sql, 'utf8').digest('hex')
}

async function main() {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error('DATABASE_URL is required for migrations')
  }

  const pool = new Pool({ connectionString })
  const client = await pool.connect()

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS qaos_migrations (
        id SERIAL PRIMARY KEY,
        filename TEXT NOT NULL UNIQUE,
        checksum TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `)

    const migrationsDir = path.join(process.cwd(), 'app', 'db', 'drizzle')
    if (!fs.existsSync(migrationsDir)) {
      console.log('[migrate] No app/db/drizzle directory found. Skipping.')
      return
    }

    const files = fs
      .readdirSync(migrationsDir)
      .filter(file => file.endsWith('.sql'))
      .sort()

    for (const filename of files) {
      const fullPath = path.join(migrationsDir, filename)
      const sql = fs.readFileSync(fullPath, 'utf8')
      const checksum = hashSql(sql)

      const existing = await client.query(
        `SELECT filename, checksum FROM qaos_migrations WHERE filename = $1 LIMIT 1`,
        [filename]
      )

      if (existing.rows[0]) {
        if (existing.rows[0].checksum !== checksum) {
          throw new Error(
            `Migration checksum mismatch for ${filename}. File was changed after apply.`
          )
        }
        console.log(`[migrate] already applied: ${filename}`)
        continue
      }

      console.log(`[migrate] applying: ${filename}`)
      await client.query('BEGIN')
      try {
        await client.query(sql)
        await client.query(`INSERT INTO qaos_migrations (filename, checksum) VALUES ($1, $2)`, [
          filename,
          checksum,
        ])
        await client.query('COMMIT')
      } catch (err) {
        await client.query('ROLLBACK')
        throw err
      }
    }

    console.log('[migrate] complete')
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch(err => {
  console.error('[migrate] failed:', err)
  process.exit(1)
})
