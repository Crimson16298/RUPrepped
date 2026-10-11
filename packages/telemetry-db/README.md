# RUPrepped telemetry database foundation

This isolated package owns SQL migrations, a parameterized PostgreSQL adapter, replay SQL, and analytics SQL. It creates no HTTP server and does not modify FastAPI or React.

## Local PostgreSQL demo setup

Docker is optional and is not required. Install PostgreSQL locally using your approved workstation setup, then create a development-only role and database. Store the resulting password only in the ignored package-local `.env` file.

```powershell
cd C:\Users\zach0\RUPrepped\packages\telemetry-db
Copy-Item .env.example .env
# Edit .env locally: replace LOCAL_PASSWORD only.
npm.cmd run check:connection
```

The local example uses `127.0.0.1` and `DATABASE_SSL=local`. The configuration rejects this mode for every non-loopback host. A remote Tiger Data/PostgreSQL URL must instead use `DATABASE_SSL=require-verify`; the package continues to require hostname and certificate verification for that path.

After the read-only check succeeds, explicitly run the guarded development commands:

```powershell
$env:TELEMETRY_MIGRATE_CONFIRM = 'apply-development'
npm.cmd run migrate
$env:TELEMETRY_SMOKE_CONFIRM = 'run-synthetic-development'
npm.cmd run smoke
npm.cmd run verify:telemetry
```

These commands do not drop, truncate, reset, or recreate existing tables. The smoke test creates only labeled synthetic records and removes only those records.

## Remote PostgreSQL / Tiger Data

Copy `.env.example` to the ignored package-local `.env`, set an approved development `DATABASE_URL`, and set `TELEMETRY_DATABASE_ENV=development`. Never commit the filled file. `DATABASE_SSL=require-verify` is mandatory: the runner always uses PostgreSQL's SSLRequest negotiation, then TLS with hostname and certificate verification enabled.

If a verified connection reports `self-signed certificate in certificate chain`, do not disable verification. Obtain the PEM root/intermediate CA bundle from the Tiger Cloud service owner or, if a managed VPN/proxy is intercepting TLS, from the organization's network-security team. Store that trusted file locally (for example, `certs/approved-development-ca.pem`, which is ignored) and set `DATABASE_CA_CERT_PATH=certs/approved-development-ca.pem` in the ignored `.env`. The package validates the file as PEM and passes it as `ssl.ca` while retaining `rejectUnauthorized: true`. Do not add `sslmode`, `sslcert`, `sslkey`, or `sslrootcert` to `DATABASE_URL`; node-postgres allows those URL fields to replace the programmatic TLS object.

Before any migration, run a read-only connection check from the interactive PowerShell environment that can resolve the Tiger Data host:

```powershell
cd C:\Users\zach0\RUPrepped\packages\telemetry-db
$env:NODE_USE_SYSTEM_CA = '1'
npm.cmd run check:connection
```

The check applies the same development, TLS, and optional CA-file validation as migrations, sets a 10-second connection/query timeout, executes only `SELECT 1`, closes its pool, and prints only a success message or a sanitized error category.

To inspect a failed TLS chain without authenticating or running SQL, use the explicit diagnostic below. It first sends PostgreSQL's SSLRequest protocol message, then upgrades only when the server confirms SSL support. It uses the database hostname for SNI and performs hostname verification. The inspector temporarily allows the TLS handshake to finish even when the certificate is untrusted so it can print certificate metadata; this exception is isolated to `inspect:tls` and is never shared with `pg` pools, migrations, or smoke tests.

```powershell
cd C:\Users\zach0\RUPrepped\packages\telemetry-db
$env:NODE_USE_SYSTEM_CA = '1'
npm.cmd run inspect:tls
```

The report contains only subject/issuer organization and common name, validity dates, TLS authorization error, hostname-verification error, and whether a presented chain certificate is self-signed. A Tiger service issuer indicates that the service owner should provide the relevant CA bundle. An organization/VPN/proxy issuer instead indicates that the network-security administrator should provide its trusted inspection CA. Never copy a displayed certificate from an untrusted source into `DATABASE_CA_CERT_PATH`.

Run `TELEMETRY_MIGRATE_CONFIRM=apply-development npm.cmd run migrate` only against an approved development database. It checks connectivity, refuses non-development configuration and partial schemas, applies only `001_telemetry.sql`, and records the migration. It never runs the optional migration. Run `TELEMETRY_SMOKE_CONFIRM=run-synthetic-development npm.cmd run smoke` only after migration to create and clean up labeled synthetic fixtures.

TimescaleDB is optional. First run `SELECT extname, extversion FROM pg_extension WHERE extname = 'timescaledb';`. Only when it returns a row may an administrator apply `002_timescaledb_optional.sql`. The physiological primary key includes `event_timestamp`, satisfying hypertable uniqueness requirements. The optional migration has no drop/truncate operation.

## Adapter

`TelemetryStore` accepts a `pg.Pool` (or a test client) and uses parameterized queries. `telemetryStoreFromDatabaseUrl()` reads `DATABASE_URL` without logging it. It supports sessions, question/answer/Gemini events, calibration decisions, consent-checked physiological summaries, idempotency, and authorized session replay.

Physiology is minimal aggregate telemetry only. There is no raw video and no raw time-series storage by default. Replay excludes physiology unless the caller explicitly requests it and supplies `authorizedForPhysiology: true`.

## Integration

Person 1 can instantiate this package from a Node worker/service boundary, or port these migration/contract rules to the existing Python persistence layer after team approval. Person 4 should request aggregate timelines and the documented analytics queries, never raw physiological values unless an authorization and consent policy explicitly permits it.

Tiger Data approval is needed for `DATABASE_URL` ownership, migration runner/role permissions, retention windows, anonymization, event taxonomy, authorization model, and whether the optional Timescale extension is enabled.
