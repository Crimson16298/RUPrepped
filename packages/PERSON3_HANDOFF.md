# Person 3 handoff

## Verified package boundaries

- `experiments/presage-poc/` is the consent-gated SmartSpectra verification harness. It emits only actual decoded metric events; it does not persist video or invent readings.
- `packages/adaptive-calibration/` is a deterministic TypeScript policy engine. Gemini's normalized answer evaluations are primary. Consented physiology can only select conservative support pacing and never changes difficulty directly.
- `packages/telemetry-db/` is a parameterized PostgreSQL library with explicit migrations, replay, analytics, idempotency, and consent enforcement. Local loopback PostgreSQL is the default demo target; Tiger Data remains optional through verified TLS.

## Presage credential cleanup

`experiments/presage-poc/.env.example` contains only the
`SMARTSPECTRA_API_KEY` variable name and a non-secret placeholder. The actual
package-local `.env` is ignored by Git and is not tracked. Any real key that
was previously committed must be treated as compromised: the account owner
must revoke it and create a replacement in the Presage dashboard. Do not run a
live measurement until the owner confirms that the replacement is installed in
the ignored local `.env` and the old key is revoked. Git history was not
rewritten as part of this cleanup.

## Suggested process boundary

FastAPI should call the small Node worker boundary (or port the documented contracts to Python after approval), never import these TypeScript packages directly. Send consented metric summaries, not webcam frames. Persist decision and telemetry events asynchronously; if the service/database is unavailable, continue the interview and report a non-fatal telemetry status.

`coordinateInterviewTurn()` in `@ruprepped/adaptive-calibration` is the narrow orchestration seam. It accepts the existing deterministic `CalibrationInput` and an optional injected `TelemetryPort`. It returns the decision immediately plus explicit camera and telemetry statuses. A Node worker should implement that port with `TelemetryStore`; FastAPI can invoke the worker over a reviewed local process/HTTP boundary and receive JSON.

`@ruprepped/telemetry-db` now exports `calibrationTelemetryPortFromStore(store)`, the concrete adapter that delegates directly to `TelemetryStore.insertEvent()` and `TelemetryStore.insertDecision()`. It retains the existing parameterized SQL and idempotency behavior. `handleWorkerRequest(value, port)` in adaptive calibration is the transport-neutral request validator: malformed payloads return `{ "ok": false, "error": "invalid_request" }`; calibration validation errors return `calibration_error`; database errors become `telemetry: "unavailable"` in a successful calibration result.

The host composition is intentionally small:

```ts
const port = calibrationTelemetryPortFromStore(store);
const response = await handleWorkerRequest(requestJson, port);
```

FastAPI must choose and own the process transport (one-shot child process, localhost HTTP, or another reviewed IPC option). No persistent Node server is started by Person 3 code.

### Ready-to-call FastAPI CLI

The package now supplies the one-shot executable boundary required for a FastAPI subprocess:

```powershell
cd C:\Users\zach0\RUPrepped\packages\adaptive-calibration
npm.cmd run build
node .\dist\src\cli.js
```

It reads one `schemaVersion: "1.0.0"` JSON request on standard input and emits one JSON response on standard output. It expects FastAPI's actual Gemini scores as integers from `0` through `100`, then normalizes them before calling the unchanged deterministic engine. It does not access Presage or PostgreSQL. Exit `0` means success, `2` means malformed/unsupported/invalid input, and `3` means calibration could not complete. Standard error contains only a category, never the request body or secret values.

FastAPI should invoke it immediately after a successful Gemini evaluation and before it asks the provider for the next question. A bounded asyncio subprocess example is available at `packages/adaptive-calibration/examples/fastapi_subprocess_example.py`; it uses a two-second timeout and maps any process failure to a non-fatal calibration fallback.

Sample request fragment:

```json
{"schemaVersion":"1.0.0","calibration":{"currentDifficulty":3,"geminiEvaluations":[{"score":90,"valid":true,"completedAt":"2026-10-10T18:01:00.000Z"},{"score":90,"valid":true,"completedAt":"2026-10-10T18:02:00.000Z"}],"performanceHistory":[],"physiologicalConsent":false,"previousDecisions":[],"session":{"sessionId":"ses_example","startedAt":"2026-10-10T18:00:00.000Z","allowPhysiologicalPacing":false},"decisionTimestamp":"2026-10-10T19:00:00.000Z"}}
```

The existing frontend vocabulary cannot fully represent Person 3 actions. Map `increase` directly; map `support` to `decrease` only when the recommended difficulty is actually lower; map pacing-only `support` and `pause` to `maintain` until Person 4 adds an explicit pacing status.

### Exact current FastAPI seam and Person 1 patch plan

In remote `origin/main` at `1d7673f`, `backend/app/services/session.py` has
the required ordering inside `submit_answer()`:

1. `provider.evaluate_answer(...)` returns an `AnswerEvaluation` with an
   integer `score` in `0..100`.
2. `choose_next_difficulty(current_question.difficulty, evaluation)` applies
   the older backend-only policy.
3. `_question_from_provider(..., adjustment.next_difficulty)` generates the
   next question.

Person 1 should replace step 2 with a bounded invocation of
`packages/adaptive-calibration/dist/src/cli.js`, using the request contract
above. Construct the request from the answer records already held by the
session: current difficulty, recent evaluation history, timestamps, and prior
calibration decisions. On exit `0` and `{ "ok": true }`, use the returned
`recommendedDifficulty` as the only next-question difficulty. On a timeout,
nonzero exit, malformed response, or `{ "ok": false }`, preserve the current
difficulty and continue the interview; do not invoke the old policy as a
second competing calibration system. Return a backend response that retains
the existing frontend-compatible adjustment while the frontend contract is
expanded.

Required backend files for Person 1 review: `backend/app/services/session.py`
(subprocess call and next-question difficulty), `backend/app/database/store.py`
(previous-decision history and a separate UUID telemetry-session mapping), and
`backend/app/schemas.py` (only if the team approves exposing richer pacing
status). No raw camera frame, video, or credential belongs in this request.

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

- Backend: invoke the Node boundary after evaluation/before next-question generation, provide the latest valid `0–100` Gemini history, preserve caller timestamps and prior decisions, replace rather than duplicate its current difficulty policy, and treat a calibration/telemetry failure as non-fatal. A separate UUID telemetry-session ID is required before telemetry writes; FastAPI's `ses_...` ID is not a database UUID.
- Frontend/Electron: obtain explicit camera consent before setting `SMARTSPECTRA_MEASUREMENT_CONSENT=yes`; render availability guidance, not diagnoses; send only consented summaries.
- Database worker: use package-local `DATABASE_URL`, `TELEMETRY_DATABASE_ENV=development`, and `DATABASE_SSL=local` only for loopback development. Remote URLs require `DATABASE_SSL=require-verify`.
- Privacy: never send raw frames, never use physiology for scoring or difficulty, and retain physiology only under approved consent/retention policy.

Offline verification currently covers Presage normalization/consent/error behavior, deterministic calibration/cooldown/physiology guards, and telemetry parameterization/idempotency/TLS configuration. Local PostgreSQL migration and smoke verification were confirmed from regular Windows PowerShell; TimescaleDB is optional and absent.

Current offline verification: Presage `check` plus 16 tests; adaptive calibration typecheck plus 19 tests; telemetry typecheck plus 14 tests; `git diff --check` passes. Live camera capture was previously verified separately and is not part of the offline suite.
