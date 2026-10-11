-- Run only after confirming TimescaleDB is installed:
-- SELECT extname, extversion FROM pg_extension WHERE extname = 'timescaledb';
-- The base schema's only unique constraint on this table is its primary key,
-- which includes event_timestamp as required by Timescale hypertables.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') THEN
    RAISE EXCEPTION 'TimescaleDB extension is not installed; do not apply 002_timescaledb_optional.sql';
  END IF;
END $$;
SELECT create_hypertable('physiological_metric_summaries', 'event_timestamp', if_not_exists => TRUE, migrate_data => TRUE);
