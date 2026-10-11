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
```

## Team integration proposal

Person 1 can call `calibrate(input)` behind an existing FastAPI service boundary (for example, a small Node sidecar or a later language-port), passing already-normalized Gemini scores and caller-owned timestamps. Person 4 should render the returned action, recommended difficulty, and plain reason, not raw physiological values. Tiger Data telemetry should store consent state, contract version, input/decision timestamps, answer-score aggregate, cooldown result, action, difficulty, and only consented measurement-quality metadata; avoid raw video and avoid retaining raw physiological values unless the team explicitly approves a retention policy.

Teammate approval is needed for the Node-to-FastAPI boundary, physiology consent/retention policy, baseline collection protocol, default cooldown, pacing deviation threshold, and user-facing wording.
