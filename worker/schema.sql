CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS posts_updated ON posts(updated_at);
CREATE TABLE IF NOT EXISTS settings (
  id TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS logs (
  id TEXT PRIMARY KEY,
  level TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS logs_created ON logs(created_at);
CREATE TABLE IF NOT EXISTS line_records (
  id TEXT PRIMARY KEY,
  post_id TEXT,
  kind TEXT NOT NULL,
  month TEXT NOT NULL,
  target_count INTEGER NOT NULL,
  state TEXT NOT NULL,
  request_id TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS line_records_month ON line_records(month);
