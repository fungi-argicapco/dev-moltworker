-- Zero Trust Agent - Phase 1 Initial Schema Migration
-- Database: crm-db
-- Version: 001
-- Created: 2026-02-26

-- ============================================================
-- TABLE: service_tokens
-- Stores encrypted API tokens for each monitored CF service
-- ============================================================
CREATE TABLE IF NOT EXISTS service_tokens (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  service         TEXT NOT NULL UNIQUE,        -- workers | d1 | stream | r2 | pages | firewall
  token_hash      TEXT NOT NULL,               -- SHA-256 hex of plaintext token
  token_enc       TEXT NOT NULL,               -- AES-256-GCM ciphertext (base64)
  enc_iv          TEXT NOT NULL,               -- AES-256-GCM IV (base64, 12 bytes)
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at      TEXT,                        -- ISO-8601 or NULL for non-expiring
  last_validated_at TEXT,                      -- Last successful CF API validation
  last_used_at    TEXT,                        -- Last time token was fetched/used
  status          TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','expired','revoked','warn')),
  scope_json      TEXT NOT NULL DEFAULT '[]'   -- JSON array of expected permission scopes
);

CREATE INDEX IF NOT EXISTS idx_service_tokens_service ON service_tokens(service);
CREATE INDEX IF NOT EXISTS idx_service_tokens_status  ON service_tokens(status);
CREATE INDEX IF NOT EXISTS idx_service_tokens_expires ON service_tokens(expires_at);

-- ============================================================
-- TABLE: audit_log
-- Immutable append-only log of all agent actions
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_log (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  ts            TEXT NOT NULL DEFAULT (datetime('now')),
  agent_id      TEXT NOT NULL DEFAULT 'zero-trust-agent',
  action        TEXT NOT NULL,                 -- validate | store | rotate | halt | warn
  service       TEXT,                          -- CF service name (nullable for global events)
  result        TEXT NOT NULL CHECK(result IN ('ok','warn','fail','halt')),
  severity      TEXT NOT NULL DEFAULT 'INFO' CHECK(severity IN ('DEBUG','INFO','WARN','ERROR','CRITICAL')),
  detail_json   TEXT NOT NULL DEFAULT '{}',    -- Arbitrary structured detail
  linear_issue  TEXT,                          -- Linked Linear issue ID (e.g. SK-33)
  portfolio_id  TEXT                           -- Stream Kinetics portfolio entity ID
);

CREATE INDEX IF NOT EXISTS idx_audit_log_ts       ON audit_log(ts);
CREATE INDEX IF NOT EXISTS idx_audit_log_service  ON audit_log(service);
CREATE INDEX IF NOT EXISTS idx_audit_log_result   ON audit_log(result);
CREATE INDEX IF NOT EXISTS idx_audit_log_severity ON audit_log(severity);
CREATE INDEX IF NOT EXISTS idx_audit_log_agent    ON audit_log(agent_id);

-- ============================================================
-- TABLE: portfolio_resources
-- Maps Cloudflare resources to Stream Kinetics portfolio entities
-- ============================================================
CREATE TABLE IF NOT EXISTS portfolio_resources (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  portfolio_id  TEXT NOT NULL,                 -- SK portfolio entity (e.g. hardshell, contentguru.ai)
  resource_type TEXT NOT NULL,                 -- workers_script | d1_database | r2_bucket | pages_project | stream_video | firewall_rule
  resource_id   TEXT NOT NULL,                 -- CF resource ID/name
  resource_name TEXT NOT NULL,                 -- Human-readable name
  tags_json     TEXT NOT NULL DEFAULT '{}'     -- Arbitrary JSON tags for classification
);

CREATE INDEX IF NOT EXISTS idx_portfolio_resources_portfolio ON portfolio_resources(portfolio_id);
CREATE INDEX IF NOT EXISTS idx_portfolio_resources_type      ON portfolio_resources(resource_type);
CREATE UNIQUE INDEX IF NOT EXISTS idx_portfolio_resources_unique ON portfolio_resources(portfolio_id, resource_type, resource_id);

-- ============================================================
-- TABLE: validation_runs
-- Summary record for each full validation sweep
-- ============================================================
CREATE TABLE IF NOT EXISTS validation_runs (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  started_at      TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at    TEXT,
  trigger         TEXT NOT NULL CHECK(trigger IN ('manual','scheduled','webhook','startup','test')),
  tokens_checked  INTEGER NOT NULL DEFAULT 0,
  tokens_valid    INTEGER NOT NULL DEFAULT 0,
  tokens_warned   INTEGER NOT NULL DEFAULT 0,
  tokens_failed   INTEGER NOT NULL DEFAULT 0,
  overall_score   REAL NOT NULL DEFAULT 0,     -- 0.0–100.0 composite trust score
  summary_json    TEXT NOT NULL DEFAULT '{}'   -- Full result breakdown as JSON
);

CREATE INDEX IF NOT EXISTS idx_validation_runs_started   ON validation_runs(started_at);
CREATE INDEX IF NOT EXISTS idx_validation_runs_trigger   ON validation_runs(trigger);
CREATE INDEX IF NOT EXISTS idx_validation_runs_score     ON validation_runs(overall_score);
