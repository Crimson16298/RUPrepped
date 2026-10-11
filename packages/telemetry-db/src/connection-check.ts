import { Pool } from 'pg';
import { databasePoolConfigFromEnvironment } from './database-config.js';

const timeoutMs = 10_000;

export type ConnectionErrorCategory =
  | 'dns_resolution_failed'
  | 'connection_timed_out'
  | 'tls_certificate_not_trusted'
  | 'postgresql_authentication_failed'
  | 'database_not_found'
  | 'connection_failed';

export function connectionErrorCategory(error: unknown): ConnectionErrorCategory {
  const value = error as { code?: string; message?: string } | undefined;
  const code = value?.code;
  const message = value?.message ?? '';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'dns_resolution_failed';
  if (code === 'ETIMEDOUT' || code === 'ECONNREFUSED') return 'connection_timed_out';
  if (['SELF_SIGNED_CERT_IN_CHAIN', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'].includes(code ?? '') || /self-signed certificate|unable to verify/i.test(message)) return 'tls_certificate_not_trusted';
  if (code === '28P01') return 'postgresql_authentication_failed';
  if (code === '3D000') return 'database_not_found';
  return 'connection_failed';
}

export async function checkConnection(): Promise<void> {
  const { poolConfig } = databasePoolConfigFromEnvironment();
  const pool = new Pool({ ...poolConfig, max: 1, connectionTimeoutMillis: timeoutMs, query_timeout: timeoutMs });
  try {
    await pool.query('SELECT 1');
  } finally {
    await pool.end();
  }
}
