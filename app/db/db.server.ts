/**
 * PostgreSQL database connection + bootstrap migrations.
 */

import fs from 'node:fs'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema'

if (!process.env.DATABASE_URL) {
  console.error('FATAL: DATABASE_URL environment variable is missing.')
  console.error(
    'Please configure it in your .env file. (e.g. DATABASE_URL=postgresql://user:password@localhost:5432/qaos)'
  )
  process.exit(1)
}

const DATABASE_URL = normalizeDatabaseUrl(process.env.DATABASE_URL)

if (!DATABASE_URL.startsWith('postgresql://') && !DATABASE_URL.startsWith('postgres://')) {
  console.error(
    'FATAL: qaos now requires PostgreSQL. DATABASE_URL must start with postgresql:// or postgres://'
  )
  process.exit(1)
}

const pool = new Pool({ connectionString: DATABASE_URL })
const db = drizzle(pool, { schema })

let initialized = false
let initPromise: Promise<void> | null = null

function isRunningInDocker() {
  return process.env.QAOS_RUNNING_IN_DOCKER === 'true' || fs.existsSync('/.dockerenv')
}

function normalizeDatabaseUrl(connectionString: string) {
  try {
    const url = new URL(connectionString)
    const isPg = url.protocol === 'postgresql:' || url.protocol === 'postgres:'
    const isComposeDbHost = url.hostname === 'db'

    if (!isPg || !isComposeDbHost || isRunningInDocker()) {
      return connectionString
    }

    url.hostname = 'localhost'
    console.warn("DATABASE_URL host 'db' detected outside Docker. Falling back to 'localhost'.")
    return url.toString()
  } catch {
    return connectionString
  }
}

async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

-- Sessions table removed (Stateless JWT)

    CREATE TABLE IF NOT EXISTS user_preferences (
      id BIGSERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
      theme TEXT NOT NULL DEFAULT 'light',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS tests (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT 'New Test',
      url TEXT,
      model TEXT,
      execution_mode TEXT NOT NULL DEFAULT 'single',
      test_account_id TEXT,
      user_id INTEGER NOT NULL DEFAULT 1,
      status TEXT DEFAULT 'idle',
      headless BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE tests ADD COLUMN IF NOT EXISTS execution_mode TEXT NOT NULL DEFAULT 'single';
    ALTER TABLE tests ALTER COLUMN execution_mode SET DEFAULT 'single';
    ALTER TABLE tests ADD COLUMN IF NOT EXISTS test_account_id TEXT;
    UPDATE tests SET execution_mode = 'single' WHERE execution_mode = 'server';
    UPDATE tests SET execution_mode = 'hybrid' WHERE execution_mode = 'local';

    CREATE TABLE IF NOT EXISTS test_messages (
      id BIGSERIAL PRIMARY KEY,
      test_id TEXT NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      screenshot_path TEXT,
      user_id INTEGER NOT NULL DEFAULT 1,
      excluded BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS test_accounts (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      account_key TEXT NOT NULL UNIQUE,
      username TEXT NOT NULL,
      password TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS test_records (
      id BIGSERIAL PRIMARY KEY,
      test_id TEXT NOT NULL,
      source_file TEXT NOT NULL,
      record_index INTEGER NOT NULL,
      title TEXT,
      priority TEXT,
      description TEXT,
      normalized_record JSONB NOT NULL,
      raw_record JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS test_suites (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      user_id INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS test_suite_tests (
      id BIGSERIAL PRIMARY KEY,
      suite_id TEXT NOT NULL REFERENCES test_suites(id) ON DELETE CASCADE,
      test_id TEXT NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
      added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(suite_id, test_id)
    );

    INSERT INTO config (key, value)
    VALUES ('provider', 'openai')
    ON CONFLICT (key) DO NOTHING;

    INSERT INTO config (key, value)
    VALUES ('model', 'gpt-4o-mini')
    ON CONFLICT (key) DO NOTHING;
  `)
}

export async function getDb() {
  if (initialized) return db
  if (!initPromise) {
    initPromise = ensureSchema().then(() => {
      initialized = true
    })
  }
  await initPromise
  return db
}

export async function closeDb() {
  await pool.end()
}

export { schema }
