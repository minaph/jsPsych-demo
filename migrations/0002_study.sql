CREATE TABLE sessions (
  session_id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  study_version TEXT NOT NULL,
  consent_version TEXT NOT NULL,
  assigned_condition TEXT NOT NULL CHECK (assigned_condition IN ('acknowledge','neutral')),
  manifest_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  resume_expires_at TEXT NOT NULL,
  delete_after TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX sessions_delete_after ON sessions(delete_after);
CREATE TABLE trials (
  session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  trial_id TEXT NOT NULL,
  scene_id TEXT NOT NULL,
  condition TEXT NOT NULL CHECK (condition IN ('acknowledge','neutral')),
  presentation_index INTEGER NOT NULL CHECK(presentation_index BETWEEN 1 AND 4),
  understanding INTEGER NOT NULL CHECK(understanding BETWEEN 1 AND 7),
  usefulness INTEGER NOT NULL CHECK(usefulness BETWEEN 1 AND 7),
  rt_ms INTEGER NOT NULL CHECK(rt_ms >= 0),
  segment_id TEXT NOT NULL,
  segment_started_at TEXT NOT NULL,
  resume_count INTEGER NOT NULL CHECK(resume_count >= 0),
  presentation_attempt INTEGER NOT NULL CHECK(presentation_attempt >= 1),
  client_answered_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  PRIMARY KEY(session_id, trial_id),
  UNIQUE(session_id, presentation_index)
);
CREATE TABLE retention_runs (
  singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
  last_success_at TEXT NOT NULL,
  deleted_sessions INTEGER NOT NULL
);
