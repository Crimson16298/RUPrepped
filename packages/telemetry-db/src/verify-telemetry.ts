import { approvedDatabaseConfig } from './database-config.js';

const tables = [
  'interview_sessions',
  'interview_events',
  'calibration_decisions',
  'physiological_metric_summaries',
] as const;

async function main(): Promise<void> {
  const { pool } = approvedDatabaseConfig();
  try {
    const counts = await Promise.all(tables.map(async (table) => {
      const result = await pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM ${table}`);
      return [table, Number(result.rows[0]?.count ?? '0')] as const;
    }));
    const timescale = await pool.query(`SELECT extname FROM pg_extension WHERE extname = 'timescaledb'`);
    console.log(JSON.stringify({ telemetryRows: Object.fromEntries(counts), timescaleInstalled: timescale.rows.length > 0 }));
  } finally {
    await pool.end();
  }
}

main().catch(() => {
  console.error('Telemetry verification failed.');
  process.exitCode = 1;
});
