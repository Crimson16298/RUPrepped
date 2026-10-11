# Person 3 handoff

## Verified package boundaries

- `experiments/presage-poc/` is the consent-gated SmartSpectra verification harness. It emits only actual decoded metric events; it does not persist video or invent readings.
- `packages/adaptive-calibration/` is a deterministic TypeScript policy engine. Gemini's normalized answer evaluations are primary. Consented physiology can only select conservative support pacing and never changes difficulty directly.
- `packages/telemetry-db/` is a parameterized PostgreSQL library with explicit migrations, replay, analytics, idempotency, and consent enforcement. Local loopback PostgreSQL is the default demo target; Tiger Data remains optional through verified TLS.

## Suggested process boundary

FastAPI should call a small Node worker/service boundary (or port the documented contracts to Python after approval), never import these TypeScript packages directly. Send normalized answer evaluations plus consented metric summaries, not webcam frames. Persist decision and telemetry events asynchronously; if the service/database is unavailable, continue the interview and report a non-fatal telemetry status.

`coordinateInterviewTurn()` in `@ruprepped/adaptive-calibration` is the narrow orchestration seam. It accepts the existing deterministic `CalibrationInput` and an optional injected `TelemetryPort`. It returns the decision immediately plus explicit camera and telemetry statuses. A Node worker should implement that port with `TelemetryStore`; FastAPI can invoke the worker over a reviewed local process/HTTP boundary and receive JSON.

`@ruprepped/telemetry-db` now exports `calibrationTelemetryPortFromStore(store)`, the concrete adapter that delegates directly to `TelemetryStore.insertEvent()` and `TelemetryStore.insertDecision()`. It retains the existing parameterized SQL and idempotency behavior. `handleWorkerRequest(value, port)` in adaptive calibration is the transport-neutral request validator: malformed payloads return `{ "ok": false, "error": "invalid_request" }`; calibration validation errors return `calibration_error`; database errors become `telemetry: "unavailable"` in a successful calibration result.

The host composition is intentionally small:

```ts
const port = calibrationTelemetryPortFromStore(store);
const response = await handleWorkerRequest(requestJson, port);
```

FastAPI must choose and own the process transport (one-shot child process, localhost HTTP, or another reviewed IPC option). No persistent Node server is started by Person 3 code.

Example result (illustrative only):

```json
{
  "decision": { "action": "maintain", "recommendedDifficulty": 3, "reason": "moderate_recent_answer_quality" },
  "camera": "not_provided_or_unavailable",
  "telemetry": "persisted"
}
```

`camera` can be `not_provided_or_unavailable`, `consent_not_granted`, `measurement_not_valid`, or `available`. It never blocks answer-based calibration. `telemetry` can be `not_configured`, `persisted`, `duplicate`, or `unavailable`; database errors do not interrupt an interview.

## Payloads for teammate approval

`PhysiologicalMetricEvent`: source, SDK callback timestamp, receipt timestamp, supported samples, original units, confidence/stability when supplied.

`CalibrationDecision`: action, recommended difficulty, machine-readable reason, `usedPhysiologicalData`, structured evidence, caller timestamp, contract version.

Telemetry persistence should record session consent, answer aggregate, decision evidence, and minimal consented metric summaries. It must not store raw video and should not expose physiology in replay without explicit authorization.

## Manual demo order

1. Run `npm.cmd run diagnose` in the Presage POC with `SMARTSPECTRA_DIAGNOSTIC_CONSENT=yes`.
2. Configure a package-local local PostgreSQL `.env`, then run `check:connection`.
3. Explicitly run the guarded migration and synthetic smoke commands from the telemetry README.
4. Run `verify:telemetry` to read table counts only.

Backend/API field names, consent wording, retention, and the Node-to-FastAPI transport require team approval before cross-component wiring.

## Teammate tasks and environment

- Backend: normalize Gemini scores to 0–1, preserve caller timestamps, invoke the Node boundary, and treat a telemetry failure as non-fatal.
- Frontend/Electron: obtain explicit camera consent before setting `SMARTSPECTRA_MEASUREMENT_CONSENT=yes`; render availability guidance, not diagnoses; send only consented summaries.
- Database worker: use package-local `DATABASE_URL`, `TELEMETRY_DATABASE_ENV=development`, and `DATABASE_SSL=local` only for loopback development. Remote URLs require `DATABASE_SSL=require-verify`.
- Privacy: never send raw frames, never use physiology for scoring or difficulty, and retain physiology only under approved consent/retention policy.

Offline verification currently covers Presage normalization/consent/error behavior, deterministic calibration/cooldown/physiology guards, and telemetry parameterization/idempotency/TLS configuration. Local PostgreSQL migration and smoke verification were confirmed from regular Windows PowerShell; TimescaleDB is optional and absent.

Current offline counts: Presage 16 tests, adaptive calibration 14 tests, telemetry 14 tests. Live camera capture was previously verified separately and is not part of the offline suite.
