CREATE TABLE IF NOT EXISTS survey_exports (
  id TEXT PRIMARY KEY,
  survey_id TEXT NOT NULL UNIQUE,
  exported_at TIMESTAMP NOT NULL DEFAULT NOW(),
  exported_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_survey_exports_exported_at ON survey_exports(exported_at);
