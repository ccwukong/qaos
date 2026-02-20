/**
 * Database connection factory — dialect switch between SQLite and PostgreSQL.
 *
 * Default: embedded SQLite via better-sqlite3 (creates .qaos/qaos.db)
 * Remote: PostgreSQL when DATABASE_URL starts with "postgresql://"
 */

import * as schema from "./schema";
import path from "node:path";
import fs from "node:fs";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

const DB_DIR = path.join(process.cwd(), ".qaos");
const DB_PATH = path.join(DB_DIR, "qaos.db");

if (!process.env.DATABASE_URL) {
  console.error("FATAL: DATABASE_URL environment variable is missing.");
  console.error("Please configure it in your .env file. (e.g. DATABASE_URL=file:./.qaos/qaos.db)");
  process.exit(1);
}

const DATABASE_URL = process.env.DATABASE_URL;

type DbInstance = ReturnType<typeof createSQLiteConnection>;

let _db: DbInstance | null = null;

// ─── SQLite Connection ─────────────────────────────────────────────────────

function createSQLiteConnection() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require("better-sqlite3");
  const { drizzle } = require("drizzle-orm/better-sqlite3");

  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }

  const sqlite = new Database(DB_PATH);
  sqlite.pragma("journal_mode = WAL");

  const db = drizzle(sqlite, { schema });

  // Inline migrations
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT 'New Chat',
      url TEXT,
      model TEXT,
      user_id INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      screenshot_path TEXT,
      user_id INTEGER NOT NULL DEFAULT 1,
      excluded INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    INSERT OR IGNORE INTO config (key, value) VALUES ('theme', 'light');
  `);

  // Migration: add user_id to existing tables that may lack it
  try {
    sqlite.exec(`ALTER TABLE sessions ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1`);
  } catch {
    // Column already exists — ignore
  }
  try {
    sqlite.exec(`ALTER TABLE messages ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1`);
  } catch {
    // Column already exists — ignore
  }

  try {
    sqlite.exec(`ALTER TABLE sessions ADD COLUMN status TEXT DEFAULT 'idle'`);
  } catch {
    // Column already exists — ignore
  }

  try {
    sqlite.exec(`ALTER TABLE sessions ADD COLUMN headless INTEGER DEFAULT 1`);
  } catch {
    // Column already exists — ignore
  }

  try {
    sqlite.exec(`ALTER TABLE messages ADD COLUMN excluded INTEGER DEFAULT 0`);
  } catch {
    // Column already exists — ignore
  }

  return db;
}

// ─── PostgreSQL Connection ──────────────────────────────────────────────────

async function createPostgresConnection() {
  // Dynamic import — only loaded when DATABASE_URL is postgresql://
  const { drizzle } = await import("drizzle-orm/node-postgres");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pg = require("pg") as { Pool: new (opts: { connectionString: string }) => unknown };

  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  const db = drizzle(pool, { schema });

  // Note: PostgreSQL schema migrations should be handled via drizzle-kit
  // or a dedicated migration runner in production.
  console.log("[DB] Connected to PostgreSQL");

  return db;
}

// ─── Connection Factory ────────────────────────────────────────────────────

/** Get the database instance (singleton). */
export function getDb() {
  if (!_db) {
    if (DATABASE_URL.startsWith("postgresql://")) {
      // For sync compatibility, we create a placeholder and initialize async.
      // In practice, the PG connection should be awaited at server startup.
      console.log("[DB] PostgreSQL detected — use getDbAsync() for full support");
      throw new Error(
        "PostgreSQL requires async initialization. Use getDbAsync() instead."
      );
    }
    _db = createSQLiteConnection();
  }
  return _db;
}

/** Async variant for PostgreSQL support. */
export async function getDbAsync() {
  if (!_db) {
    if (DATABASE_URL.startsWith("postgresql://")) {
      _db = (await createPostgresConnection()) as unknown as DbInstance;
    } else {
      _db = createSQLiteConnection();
    }
  }
  return _db;
}

export { schema };
