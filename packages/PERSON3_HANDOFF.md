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

### Shadow-mode FastAPI seam and Person 1 patch plan

In remote `origin/main` at `1d7673f`, `backend/app/services/session.py` has
the required ordering inside `submit_answer()`:

1. `provider.evaluate_answer(...)` returns an `AnswerEvaluation` with an
   integer `score` in `0..100`.
2. `choose_next_difficulty(current_question.difficulty, evaluation)` applies
   the older backend-only policy.
3. `_question_from_provider(..., adjustment.next_difficulty)` generates the
   next question.

For the current milestone, Person 1 must keep step 2 unchanged: Python's
`choose_next_difficulty(...)` remains the only applied next-question policy.
After that decision is available, invoke
`packages/adaptive-calibration/dist/src/cli.js` with the same answer history,
timestamps, and current difficulty. Its result is comparison-only. On exit
`0` and `{ "ok": true }`, build a transcript-free comparison record with the
session, question, and answer identifiers; Python's selected difficulty; the
Node recommendation; agreement; execution duration; schema version; and node
status. On a two-second timeout, nonzero exit, malformed response, or
`{ "ok": false }`, write a status-only comparison record and continue the
interview normally. Never display a shadow recommendation as an applied
frontend adjustment.

`buildShadowComparison()` in
`packages/adaptive-calibration/src/shadow-comparison.ts` implements the
sanitized comparison shape. It always sets `authoritativeDifficulty` to the
Python-selected value, so a Node recommendation cannot alter the interview.

Required backend files for Person 1 review: `backend/app/services/session.py`
(non-blocking comparison subprocess after the Python decision),
`backend/app/database/store.py` (answer/decision history in memory; a separate
UUID telemetry-session mapping only when telemetry is approved), and
`backend/app/schemas.py` only if the team approves exposing a shadow status.
No raw camera frame, video, credential, or transcript belongs in a comparison
record.

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

## Proposed Presage active-session association

Implemented locally in `experiments/presage-poc/src/session-measurement-adapter.mjs`:
the local camera host can bind a real decoded SmartSpectra event to the active
FastAPI `session_id` after explicit consent. It sends no frames or video. The
adapter emits only samples with SDK validation code `0`, confidence at least
70, and `stable: true`; it emits status-only outcomes for unavailable camera,
denied/revoked consent, invalid readiness, and poor quality. Revocation stops
all summaries immediately. The adapter does not persist anything and does not
affect Gemini grading or the Python policy.

This is implemented and offline-tested, but not wired into FastAPI, frontend,
or Electron. Electron's repository files are currently placeholders, so the
smallest viable live host remains the existing local Node POC/companion. Person
4 must provide explicit consent/status controls, and Person 1 must approve a
summary-only process boundary associated with the active `session_id`.

### Person 4 transport handoff

Use Chrome plus the local Node companion for the demo. The installed Presage
Node SDK captures from the camera in its own process; React receives only
loopback JSON/SSE summaries. Electron is the fallback after its owner adds the
documented renderer-media-stream and preload IPC bridge.

Start the companion from `experiments/presage-poc` with a local,
non-committed `PRESAGE_COMPANION_TOKEN` (32+ characters), then configure the
same local capability value for the React development client. The companion is
bound solely to `127.0.0.1:8765`, restricts origins to the configured Vite
origins, and requires `X-Presage-Capability` on every request. Native
`EventSource` cannot carry this header, so subscribe with `fetch()` and parse
the SSE frames.

`experiments/presage-poc/src/companion-client.mjs` is the reference browser
compatibility re-export. The canonical browser package is
`@ruprepped/presage-companion-client` at
`packages/presage-companion-client/`; it accepts the configured loopback URL
and capability token, refuses non-loopback URLs, and exposes `status()`,
`start(sessionId)`, `subscribe(sessionId, { onEvent, signal })`, and
`stop(sessionId)`. It has no Node-only imports and includes a TypeScript
declaration, so Person 4 should add it as a local frontend dependency instead
of importing from `experiments/` across Vite's filesystem boundary:

```powershell
cd C:\Users\zach0\RUPrepped\frontend
npm.cmd install --save file:../packages/presage-companion-client
```

```ts
import { createPresageCompanionClient } from "@ruprepped/presage-companion-client";
```

For a local demo, generate one fresh capability token per run and write it to
the ignored `frontend/.env.local` as `VITE_PRESAGE_COMPANION_TOKEN`; set the
same value as `PRESAGE_COMPANION_TOKEN` in the PowerShell process that starts
the companion. `VITE_*` values are visible to JavaScript executing in that
browser origin, so this is a browser-visible, limited local-development
credential—not secret storage and never the Presage API key. Do not put the
token in URLs, logs, or committed files. The loopback binding, origin
allowlist, and header check remain necessary additional controls.

1. On explicit camera opt-in and once `session.id` exists, `POST
   /v1/presage/start` with `{ "sessionId": session.id, "consent": true }`.
2. Read `GET /v1/presage/status`, then fetch-stream `GET
   /v1/presage/events?sessionId=<encoded session.id>`.
3. For `type: "measurement"`, pass `metrics` directly to
   `PresageMeasurements` as `measurements`, set
   `availability="available"`, and set `source="presage-smartspectra"`.
   Each metric already has `metric`, `value`, ISO `measuredAt`, confidence,
   and stable fields. Pulse unit is `bpm`; breathing is `breaths/min`; HRV
   RMSSD has no unit because the SDK declaration provides none.
4. Map `awaiting_consent` to `not-requested`; `starting`/`warming_up` to
   `warming-up`; `quality_insufficient`, `unavailable`, `stopped`, and `error`
   to `unavailable`. The current Node SDK cannot distinguish OS permission
   denial from its generic input-unavailable signal, so the current integration
   must render that state as `unavailable` unless a separately verified
   platform-permission signal is available.
5. On consent revocation, interview completion, session replacement, component
   unmount, tab close, or stream failure: close the fetch reader, clear local
   readings, and `POST /v1/presage/stop` with the same session ID. Cross-session
   calls are rejected; never reuse a previous session's readings.

This transport never sends video, hints, raw frames, API keys, or transcripts.
It does not persist readings and does not affect Gemini feedback, shadow
comparison, or actual difficulty. Real camera verification remains blocked
until the owner confirms credential rotation.

## Manual demo order

1. Run `npm.cmd run diagnose` in the Presage POC with `SMARTSPECTRA_DIAGNOSTIC_CONSENT=yes`.
2. Configure a package-local local PostgreSQL `.env`, then run `check:connection`.
3. Explicitly run the guarded migration and synthetic smoke commands from the telemetry README.
4. Run `verify:telemetry` to read table counts only.

Backend/API field names, consent wording, retention, and the Node-to-FastAPI transport require team approval before cross-component wiring.

## Teammate tasks and environment

- Backend: keep Python difficulty policy authoritative; invoke the Node boundary only for comparison after the Python decision, provide the latest valid `0–100` Gemini history, preserve caller timestamps and prior decisions, and treat every Node/telemetry failure as non-fatal. A separate UUID telemetry-session ID is required before telemetry writes; FastAPI's `ses_...` ID is not a database UUID.
- Frontend/Electron: obtain explicit camera consent before setting `SMARTSPECTRA_MEASUREMENT_CONSENT=yes`; render availability guidance, not diagnoses; send only consented summaries.
- Database worker: use package-local `DATABASE_URL`, `TELEMETRY_DATABASE_ENV=development`, and `DATABASE_SSL=local` only for loopback development. Remote URLs require `DATABASE_SSL=require-verify`.
- Privacy: never send raw frames, never use physiology for scoring or difficulty, and retain physiology only under approved consent/retention policy.

Offline verification currently covers Presage normalization/consent/error behavior, deterministic calibration/cooldown/physiology guards, and telemetry parameterization/idempotency/TLS configuration. Local PostgreSQL migration and smoke verification were confirmed from regular Windows PowerShell; TimescaleDB is optional and absent.

Current offline verification: Presage `check` plus 27 tests; adaptive calibration typecheck plus 22 tests; telemetry typecheck plus 14 tests; `git diff --check` passes. Live camera capture was previously verified separately and is not part of the offline suite. Credential rotation remains awaiting owner confirmation; do not run a live session until the old key is revoked and a replacement is installed locally.

## Verified Presage companion transport contract (v1.0.0)

This section is the implementation contract for Person 4. It is derived from
`companion-core.mjs`, `companion-server-core.mjs`, the browser client, and
their offline tests. The current demo choice is **Chrome plus the local Node
companion**. Electron remains a future alternative once its main/preload/
renderer bridge is implemented; it is not needed for this transport.

The service binds only to `http://127.0.0.1:8765`. Every route requires both
an allowed `Origin` and an exact `X-Presage-Capability` value. The browser
client accepts only `http://127.0.0.1` or `http://localhost` base URLs.

### Requests and responses

`POST /v1/presage/start` body (both fields required):

```json
{"sessionId":"ses_example","consent":true}
```

An accepted start returns HTTP 200. It returns the current local companion
status, which can be `starting` or `warming_up` depending on synchronous SDK
events. A repeated start for the same active session additionally has
`"duplicate":true`. A different active session, unavailable camera, or SDK
startup failure returns HTTP 409 with `accepted:false` and a status; this does
not mean a measurement exists.

```json
{"accepted":true,"status":"warming_up"}
```

`GET /v1/presage/status` returns the current snapshot. `sessionId` is present
only while a session is active (JavaScript omits an `undefined` field in JSON).
This endpoint deliberately has no `emittedAt` timestamp.

```json
{"schemaVersion":"1.0.0","type":"status","sessionId":"ses_example","status":"warming_up"}
```

`POST /v1/presage/stop` body:

```json
{"sessionId":"ses_example"}
```

It accepts only the currently active session, revokes local consent, calls the
SDK's `stopAsync()` and `destroy()` best-effort, clears the association, and
returns HTTP 200. Because the session has been cleared, the successful JSON
response contains no `sessionId` field:

```json
{"schemaVersion":"1.0.0","type":"status","status":"stopped"}
```

The corresponding SSE status event retains `sessionId` and has a `reason`, so
the UI should wait for that event when it needs to associate a stop with its
session.

All JSON error bodies contain exactly an `error` string. Implemented examples
are `{"error":"unauthorized"}` (HTTP 403 for a bad origin or token),
`{"error":"invalid_start_request"}` (HTTP 400),
`{"error":"session_not_active"}` (HTTP 403), `{"error":"not_found"}`
(HTTP 404), and `{"error":"invalid_request"}` (HTTP 400 malformed JSON).
Errors intentionally contain no SDK message, credentials, or camera data.

### SSE event schemas

Subscribe with authenticated `fetch`, not `EventSource`:
`GET /v1/presage/events?sessionId=ses_example`. It sends one initial status
snapshot and then `event: status` or `event: measurement` frames. All emitted
events have `schemaVersion: "1.0.0"` and `emittedAt`, an ISO-8601 UTC string
from JavaScript `Date#toISOString()`.

A status event has required `schemaVersion`, `emittedAt`, `type: "status"`,
and `status`; `sessionId` is present while an event relates to an active or
just-stopped session. It may additionally carry `reason`, `validationCode`,
or the SDK error fields `code`, `classification`, and `retryable`:

```json
{"schemaVersion":"1.0.0","emittedAt":"2026-10-11T03:00:00.100Z","type":"status","sessionId":"ses_example","status":"quality_insufficient","validationCode":7}
```

The supported status values are `awaiting_consent`, `starting`, `warming_up`,
`measuring`, `quality_insufficient`, `unavailable`, `stopped`, and `error`.
`permission_denied` is **not** an emitted Node-companion status: SDK input
unavailability is conservatively represented as `unavailable`.

A measurement event is sent only after consent, SDK validation code `0`, and
at least one sample with numeric confidence at least 70 and `stable: true`.
The following is the exact shape when the SDK has supplied all three supported
metrics; individual metrics are omitted when the SDK did not supply them.
`observedAt` and each `measuredAt` are ISO-8601 UTC receipt timestamps
generated when the SDK metrics callback reaches the POC; the transport
separately sets `emittedAt` when it serializes the SSE event. The raw SDK
microsecond callback timestamp is intentionally not sent through this
companion contract. The numeric values below are contract-valid sample values,
not a claim of a live measurement.

```json
{
  "schemaVersion":"1.0.0",
  "emittedAt":"2026-10-11T03:00:00.101Z",
  "type":"measurement",
  "sessionId":"ses_example",
  "observedAt":"2026-10-11T03:00:00.100Z",
  "metrics":[
    {"metric":"pulseRate","value":72,"unit":"bpm","confidence":90,"stable":true,"measuredAt":"2026-10-11T03:00:00.100Z"},
    {"metric":"breathingRate","value":14.2,"unit":"breaths/min","confidence":90,"stable":true,"measuredAt":"2026-10-11T03:00:00.100Z"},
    {"metric":"hrvRmssd","value":31.5,"confidence":90,"stable":true,"measuredAt":"2026-10-11T03:00:00.100Z"}
  ],
  "quality":{"validationCode":0,"confidence":90,"stable":true}
}
```

`metrics` contains one or more supported samples. `metric`, `value`,
`confidence`, `stable`, and `measuredAt` are required on each emitted sample.
`unit` is required for `pulseRate` (`bpm`) and `breathingRate`
(`breaths/min`), but is deliberately omitted for optional `hrvRmssd`: SDK
v3.4.0 does not define an RMSSD unit. The aggregate quality confidence is the
minimum confidence across the emitted samples; `stable` is always `true` for
an accepted event. No raw frame, video, camera hint, API key, or transcript is
ever present.

### Person 4 client usage

After a reviewed frontend copy/import of `createPresageCompanionClient`, the
component boundary is direct. `PresageMeasurements.tsx` expects the same
metric names and uses its own documented display units, so discard only the
transport-only `quality` field for presentation:

```ts
const client = createPresageCompanionClient({
  baseUrl: "http://127.0.0.1:8765",
  capabilityToken: localCapabilityToken,
});
const controller = new AbortController();
await client.start(session.id); // only after the explicit camera opt-in
void client.subscribe(session.id, {
  signal: controller.signal,
  onEvent(event) {
    if (event.type === "measurement") {
      setAvailability("available");
      setMeasurements(event.metrics);
    } else if (event.type === "status") {
      setAvailability(event.status === "starting" || event.status === "warming_up"
        ? "warming-up"
        : event.status === "awaiting_consent" ? "not-requested"
        : event.status === "measuring" ? "available"
        : "unavailable");
    }
  },
});
// On consent withdrawal, interview end, replacement, unmount, or stream error:
controller.abort();
setMeasurements([]);
await client.stop(session.id);
```

Do not render `permission-denied` from this Node transport unless a separate,
verified browser/platform permission signal exists. A failure to start, a
camera removed during use, invalid/low-quality measurements, or an SDK error
must leave the text interview running and show an unavailable/non-diagnostic
state. The frontend should discard any event whose `sessionId` does not equal
the current `session.id`, even though the transport also enforces it.
