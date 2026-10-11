# Adaptive calibration engine

Deterministic, isolated interview-difficulty policy. It has no network, Presage, UI, FastAPI, Gemini, or database dependency.

## Rules

- The three most recent valid normalized Gemini evaluations drive difficulty: fewer than two maintain; average >= 0.85 increases one level; 0.60–<0.85 maintains; below 0.60 supports and lowers at most one level.
- A caller-configured cooldown blocks a proposed difficulty change.
- Physiology is optional and cannot increase difficulty. It is considered only with explicit consent, a valid/fresh/stable sample, confidence >= 70 by default, a caller baseline, an explicit session pacing opt-in, and a raw relative-deviation guard. Its only effect is `support` while keeping the current difficulty. This is pacing policy, not a stress, anxiety, deception, or competence assessment.
- `decisionTimestamp` is caller-provided, so identical input and config yield identical output.

## Commands

```powershell
npm.cmd install
npm.cmd run typecheck
npm.cmd test
npm.cmd run example
npm.cmd run calibrate:stdin
```

## FastAPI subprocess boundary

Build once, then FastAPI may invoke `node dist/src/cli.js` as a bounded child
process. The process reads exactly one JSON document from standard input and
writes exactly one JSON document to standard output. It never opens a camera,
connects to PostgreSQL, or starts a persistent service.

The boundary uses `schemaVersion: "1.0.0"`. It expects FastAPI/Gemini scores as
integers from `0` through `100` and converts them to the engine's normalized
`0` through `1` scale. Inputs such as `101`, `0.9`, or a missing
`geminiEvaluations` array are rejected.

```json
{
  "schemaVersion": "1.0.0",
  "calibration": {
    "currentDifficulty": 3,
    "geminiEvaluations": [
      { "score": 90, "valid": true, "completedAt": "2026-10-10T18:01:00.000Z" },
      { "score": 90, "valid": true, "completedAt": "2026-10-10T18:02:00.000Z" }
    ],
    "performanceHistory": [],
    "physiologicalConsent": false,
    "previousDecisions": [],
    "session": { "sessionId": "ses_example", "startedAt": "2026-10-10T18:00:00.000Z", "allowPhysiologicalPacing": false },
    "decisionTimestamp": "2026-10-10T19:00:00.000Z"
  }
}
```

This input produces a response shaped like:

```json
{"ok":true,"result":{"decision":{"action":"increase","recommendedDifficulty":4,"reason":"high_recent_answer_quality"},"camera":"not_provided_or_unavailable","telemetry":"not_configured"}}
```

Exit code `0` means a valid calibration result was written. Exit code `2`
means malformed JSON, an unsupported schema version, or an invalid request.
Exit code `3` means the worker could not complete calibration. Diagnostics are
category-only messages on standard error; neither input content nor secrets are
logged. See `examples/fastapi_subprocess_example.py` for a bounded two-second
FastAPI-side invocation pattern.

### Existing frontend decision mapping

The current frontend only accepts `increase`, `maintain`, and `decrease`.
`toExistingFrontendDifficultyDecision()` maps Person 3 decisions without
misstating a level change: `increase` remains `increase`; a `support` decision
maps to `decrease` only when its recommended level is lower; pacing-only
`support` and `pause` map to `maintain`. A future frontend status field is
needed to display supportive pacing or pause semantics fully.

## Team integration proposal

Person 1 should call the CLI after Gemini evaluation and before generating the
next question. The CLI performs score normalization, so FastAPI must send its
actual `0–100` evaluation history plus caller-owned timestamps and prior
decisions. Person 4 should render the returned action, recommended difficulty,
and plain reason, not raw physiological values. Tiger Data telemetry should
store consent state, contract version, input/decision timestamps, answer-score
aggregate, cooldown result, action, difficulty, and only consented
measurement-quality metadata; avoid raw video and avoid retaining raw
physiological values unless the team explicitly approves a retention policy.

Teammate approval is needed for the Node-to-FastAPI boundary, physiology consent/retention policy, baseline collection protocol, default cooldown, pacing deviation threshold, and user-facing wording.
