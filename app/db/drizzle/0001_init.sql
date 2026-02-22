CREATE TABLE IF NOT EXISTS tests (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT 'New Test',
  url TEXT,
  model TEXT,
  test_account_id TEXT,
  user_id INTEGER NOT NULL DEFAULT 1,
  status TEXT DEFAULT 'idle',
  headless BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE tests ADD COLUMN IF NOT EXISTS test_account_id TEXT;

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

INSERT INTO config (key, value)
VALUES ('provider', 'openai')
ON CONFLICT (key) DO NOTHING;

INSERT INTO config (key, value)
VALUES ('model', 'gpt-4o-mini')
ON CONFLICT (key) DO NOTHING;
