import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool, type PoolConfig } from 'pg';
import { TelemetryValidationError } from './validation.js';

const moduleParentDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Source files live in src/, while compiled files live in dist/src/. Resolve the
// package root in either layout so local configuration is never CWD-dependent.
export const packageDirectory = existsSync(resolve(moduleParentDirectory, '.env.example'))
  ? moduleParentDirectory
  : resolve(moduleParentDirectory, '..');
const localEnv = resolve(packageDirectory, '.env');
if (existsSync(localEnv)) process.loadEnvFile(localEnv);

const tlsUriParameters = ['sslcert', 'sslkey', 'sslrootcert', 'sslmode'];
const localHosts = new Set(['127.0.0.1', '::1', 'localhost']);

export function databasePoolConfigFromEnvironment(environment: NodeJS.ProcessEnv = process.env): {
  poolConfig: PoolConfig; host: string; port: number; database: string;
} {
  const connectionString = environment.DATABASE_URL;
  if (!connectionString) throw new TelemetryValidationError('DATABASE_URL is required.');
  if (environment.TELEMETRY_DATABASE_ENV !== 'development') throw new TelemetryValidationError('TELEMETRY_DATABASE_ENV must equal development.');
  let parsed: URL;
  try { parsed = new URL(connectionString); } catch { throw new TelemetryValidationError('DATABASE_URL must be a valid PostgreSQL URL.'); }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) throw new TelemetryValidationError('DATABASE_URL must use PostgreSQL.');
  const sslMode = environment.DATABASE_SSL;
  const isLoopback = localHosts.has(parsed.hostname.toLowerCase());
  if (sslMode !== 'require-verify' && sslMode !== 'local') {
    throw new TelemetryValidationError('DATABASE_SSL must equal require-verify or local.');
  }
  if (sslMode === 'local' && !isLoopback) {
    throw new TelemetryValidationError('DATABASE_SSL=local is permitted only for a loopback PostgreSQL host.');
  }
  const port = parsed.port ? Number(parsed.port) : 5432;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new TelemetryValidationError('DATABASE_URL must contain a valid PostgreSQL port.');
  const conflictingParameter = tlsUriParameters.find((parameter) => parsed.searchParams.has(parameter));
  if (conflictingParameter) throw new TelemetryValidationError(`DATABASE_URL must not contain ${conflictingParameter}; TLS is configured programmatically.`);
  const configuredCaPath = environment.DATABASE_CA_CERT_PATH;
  if (sslMode === 'local' && configuredCaPath) throw new TelemetryValidationError('DATABASE_CA_CERT_PATH is not used with DATABASE_SSL=local.');
  let ca: string | undefined;
  if (configuredCaPath) {
    const certificatePath = resolve(packageDirectory, configuredCaPath);
    if (!existsSync(certificatePath) || !statSync(certificatePath).isFile()) throw new TelemetryValidationError('DATABASE_CA_CERT_PATH must identify a readable certificate file.');
    try { ca = readFileSync(certificatePath, 'utf8'); } catch { throw new TelemetryValidationError('DATABASE_CA_CERT_PATH could not be read.'); }
    if (!/-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----/.test(ca)) throw new TelemetryValidationError('DATABASE_CA_CERT_PATH must contain PEM certificate data.');
  }
  // Local loopback PostgreSQL commonly uses its normal non-TLS development
  // transport. Remote endpoints always retain PostgreSQL SSLRequest + full
  // certificate and hostname verification.
  const poolConfig: PoolConfig = sslMode === 'local'
    ? { connectionString, ssl: false }
    : { connectionString, sslnegotiation: 'postgres', ssl: { rejectUnauthorized: true, ...(ca ? { ca } : {}) } };
  return { poolConfig, host: parsed.hostname, port, database: decodeURIComponent(parsed.pathname.replace(/^\//, '')) };
}

export function approvedDatabaseConfig(): { pool: Pool; host: string; database: string } {
  const { poolConfig, host, database } = databasePoolConfigFromEnvironment();
  return { pool: new Pool(poolConfig), host, database };
}

export function requireConfirmation(variable: string, expected: string): void {
  if (process.env[variable] !== expected) throw new TelemetryValidationError(`${variable} must equal ${expected}.`);
}
