-- Standard PostgreSQL migration. UUID values are supplied by the application;
-- this avoids requiring a server extension merely to create identifiers.
CREATE TABLE interview_sessions (
  session_id uuid PRIMARY KEY,
  pseudonymous_user_id text NOT NULL,
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  status text NOT NULL CHECK (status IN ('active','completed','abandoned')),
  physiology_consent boolean NOT NULL DEFAULT false,
  consent_reference text,
  session_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CHECK (ended_at IS NULL OR ended_at >= started_at)
);
CREATE TABLE interview_events (
  event_id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES interview_sessions(session_id) ON DELETE RESTRICT,
  event_timestamp timestamptz NOT NULL,
  event_type text NOT NULL CHECK (length(event_type) > 0),
  question_id text,
  event_payload jsonb NOT NULL,
  schema_version text NOT NULL,
  idempotency_key text NOT NULL,
  UNIQUE (session_id, idempotency_key)
);
CREATE INDEX interview_events_timeline_idx ON interview_events (session_id, event_timestamp, event_id);
CREATE TABLE calibration_decisions (
  decision_id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES interview_sessions(session_id) ON DELETE RESTRICT,
  event_timestamp timestamptz NOT NULL,
  action text NOT NULL CHECK (action IN ('increase','maintain','support','pause')),
  previous_difficulty smallint NOT NULL CHECK (previous_difficulty BETWEEN 1 AND 5),
  recommended_difficulty smallint NOT NULL CHECK (recommended_difficulty BETWEEN 1 AND 5),
  decision_reason text NOT NULL,
  contract_version text NOT NULL,
  answer_score_aggregate double precision CHECK (answer_score_aggregate BETWEEN 0 AND 1),
  physiology_used boolean NOT NULL DEFAULT false,
  structured_evidence jsonb NOT NULL,
  idempotency_key text NOT NULL,
  UNIQUE (session_id, idempotency_key)
);
CREATE INDEX calibration_decisions_timeline_idx ON calibration_decisions (session_id, event_timestamp, decision_id);
-- Composite primary key includes time so the table is eligible for optional
-- Timescale conversion. Global idempotency is kept in the ordinary table below.
CREATE TABLE physiological_metric_summaries (
  summary_id uuid NOT NULL,
  session_id uuid NOT NULL REFERENCES interview_sessions(session_id) ON DELETE RESTRICT,
  event_timestamp timestamptz NOT NULL,
  metric_type text NOT NULL CHECK (metric_type IN ('pulseRate','breathingRate','hrvRmssd')),
  aggregate_value double precision NOT NULL CHECK (aggregate_value = aggregate_value),
  unit text,
  confidence double precision CHECK (confidence BETWEEN 0 AND 100),
  stable boolean NOT NULL,
  valid boolean NOT NULL,
  consent_reference text NOT NULL,
  PRIMARY KEY (summary_id, event_timestamp)
);
CREATE INDEX physiological_metric_summaries_timeline_idx ON physiological_metric_summaries (session_id, event_timestamp, summary_id);
CREATE TABLE telemetry_idempotency (
  session_id uuid NOT NULL REFERENCES interview_sessions(session_id) ON DELETE RESTRICT,
  record_type text NOT NULL,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, record_type, idempotency_key)
);
CREATE TABLE telemetry_schema_migrations (
  migration_name text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
