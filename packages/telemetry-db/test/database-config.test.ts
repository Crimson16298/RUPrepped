import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { connectionErrorCategory, databasePoolConfigFromEnvironment, summarizePeerCertificateChain, TelemetryValidationError } from '../src/index.js';

const baseEnvironment = (): NodeJS.ProcessEnv => ({
  DATABASE_URL: 'postgresql://user:password@approved-development.example.test:5432/ruprepped_dev',
  TELEMETRY_DATABASE_ENV: 'development',
  DATABASE_SSL: 'require-verify',
});

test('uses verified TLS without a custom CA by default', () => {
  const { poolConfig } = databasePoolConfigFromEnvironment(baseEnvironment());
  assert.equal(poolConfig.sslnegotiation, 'postgres');
  assert.deepEqual(poolConfig.ssl, { rejectUnauthorized: true });
});

test('allows normal PostgreSQL transport only for a loopback local development database', () => {
  const { poolConfig } = databasePoolConfigFromEnvironment({
    DATABASE_URL: 'postgresql://ruprepped:local-password@127.0.0.1:5432/ruprepped',
    TELEMETRY_DATABASE_ENV: 'development',
    DATABASE_SSL: 'local',
  });
  assert.equal(poolConfig.ssl, false);
  assert.throws(() => databasePoolConfigFromEnvironment({ ...baseEnvironment(), DATABASE_SSL: 'local' }), TelemetryValidationError);
});

test('loads a trusted PEM CA while retaining certificate verification', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ruprepped-ca-'));
  const certificate = join(directory, 'test-ca.pem');
  try {
    writeFileSync(certificate, '-----BEGIN CERTIFICATE-----\nsynthetic-test-ca\n-----END CERTIFICATE-----\n');
    const { poolConfig } = databasePoolConfigFromEnvironment({ ...baseEnvironment(), DATABASE_CA_CERT_PATH: certificate });
    assert.deepEqual(poolConfig.ssl, { rejectUnauthorized: true, ca: '-----BEGIN CERTIFICATE-----\nsynthetic-test-ca\n-----END CERTIFICATE-----\n' });
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('rejects missing or non-PEM custom CA files', () => {
  assert.throws(() => databasePoolConfigFromEnvironment({ ...baseEnvironment(), DATABASE_CA_CERT_PATH: 'certs/missing.pem' }), TelemetryValidationError);
  const directory = mkdtempSync(join(tmpdir(), 'ruprepped-ca-'));
  const certificate = join(directory, 'not-a-certificate.pem');
  try {
    writeFileSync(certificate, 'not pem');
    assert.throws(() => databasePoolConfigFromEnvironment({ ...baseEnvironment(), DATABASE_CA_CERT_PATH: certificate }), TelemetryValidationError);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('rejects TLS options in DATABASE_URL that override programmatic TLS', () => {
  assert.throws(() => databasePoolConfigFromEnvironment({ ...baseEnvironment(), DATABASE_URL: 'postgresql://user:password@approved-development.example.test:5432/ruprepped_dev?sslmode=require' }), TelemetryValidationError);
});

test('connection diagnostic reports sanitized error categories', () => {
  assert.equal(connectionErrorCategory({ code: 'SELF_SIGNED_CERT_IN_CHAIN' }), 'tls_certificate_not_trusted');
  assert.equal(connectionErrorCategory({ code: '28P01' }), 'postgresql_authentication_failed');
  assert.equal(connectionErrorCategory({ code: 'ENOTFOUND' }), 'dns_resolution_failed');
  assert.equal(connectionErrorCategory(new Error('unexpected failure')), 'connection_failed');
});

test('TLS inspector summarizes a chain without PEM data', () => {
  type SyntheticCertificate = {
    subject: { O: string; CN: string };
    issuer: { O: string; CN: string };
    valid_from: string;
    valid_to: string;
    fingerprint256: string;
    issuerCertificate?: SyntheticCertificate;
  };
  const root: SyntheticCertificate = { subject: { O: 'Synthetic Root', CN: 'root.example.test' }, issuer: { O: 'Synthetic Root', CN: 'root.example.test' }, valid_from: 'Jan  1 00:00:00 2026 GMT', valid_to: 'Jan  1 00:00:00 2036 GMT', fingerprint256: 'root' };
  root.issuerCertificate = root;
  const leaf = { subject: { O: 'Synthetic Service', CN: 'database.example.test' }, issuer: { O: 'Synthetic Root', CN: 'root.example.test' }, valid_from: 'Jan  1 00:00:00 2026 GMT', valid_to: 'Jan  1 00:00:00 2027 GMT', fingerprint256: 'leaf', issuerCertificate: root };
  assert.deepEqual(summarizePeerCertificateChain(leaf), [
    { subject: { organization: 'Synthetic Service', commonName: 'database.example.test' }, issuer: { organization: 'Synthetic Root', commonName: 'root.example.test' }, validFrom: 'Jan  1 00:00:00 2026 GMT', validTo: 'Jan  1 00:00:00 2027 GMT', selfSigned: false },
    { subject: { organization: 'Synthetic Root', commonName: 'root.example.test' }, issuer: { organization: 'Synthetic Root', commonName: 'root.example.test' }, validFrom: 'Jan  1 00:00:00 2026 GMT', validTo: 'Jan  1 00:00:00 2036 GMT', selfSigned: true },
  ]);
});
