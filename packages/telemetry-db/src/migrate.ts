import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { approvedDatabaseConfig, packageDirectory, requireConfirmation } from './database-config.js';

const migrationName = '001_telemetry.sql';
const expectedTables = ['interview_sessions','interview_events','calibration_decisions','physiological_metric_summaries','telemetry_idempotency','telemetry_schema_migrations'];

async function main(): Promise<void> {
  requireConfirmation('TELEMETRY_MIGRATE_CONFIRM', 'apply-development');
  const { pool, host, database } = approvedDatabaseConfig();
  try {
    await pool.query('SELECT 1');
    // Host/database are logged only after the explicit development guard succeeds.
    console.log(`Connected to approved development database ${database} on ${host}.`);
    const existing = await pool.query<{ table_name: string }>(`SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = ANY($1::text[])`, [expectedTables]);
    const names = new Set(existing.rows.map((row) => row.table_name));
    if (names.size === expectedTables.length) { console.log(`${migrationName} already present; no schema change made.`); return; }
    if (names.size > 0) throw new Error(`Refusing migration: partial telemetry schema exists (${[...names].sort().join(', ')}).`);
    const sql = await readFile(resolve(packageDirectory, 'migrations', migrationName), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO telemetry_schema_migrations (migration_name) VALUES ($1)', [migrationName]);
      await client.query('COMMIT');
      console.log(`${migrationName} applied. Optional TimescaleDB migration was not executed.`);
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  } finally { await pool.end(); }
}
main().catch((error: Error) => { console.error(`Migration failed: ${error.message}`); process.exitCode = 1; });
