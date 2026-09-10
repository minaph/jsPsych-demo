CREATE TABLE hello_responses (
  id TEXT PRIMARY KEY,
  response TEXT NOT NULL CHECK (response = 'hello'),
  rt_ms INTEGER NOT NULL CHECK (rt_ms BETWEEN 0 AND 86400000),
  saved_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  delete_after INTEGER NOT NULL DEFAULT (unixepoch() + 30 * 24 * 60 * 60)
);

CREATE INDEX hello_responses_expiry ON hello_responses(delete_after);
