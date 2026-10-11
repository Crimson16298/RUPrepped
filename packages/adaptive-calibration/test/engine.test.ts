import assert from 'node:assert/strict';
import test from 'node:test';
import { calibrate, CalibrationInputError } from '../src/index.js';
import type { CalibrationInput } from '../src/types.js';

const now = '2026-10-10T19:00:00.000Z';
const evaluation = (score: number, minute: number, valid = true) => ({ score, valid, completedAt: `2026-10-10T18:${String(minute).padStart(2, '0')}:00.000Z` });
const base = (overrides: Partial<CalibrationInput> = {}): CalibrationInput => ({
  currentDifficulty: 3, geminiEvaluations: [evaluation(0.7, 1), evaluation(0.7, 2), evaluation(0.7, 3)], performanceHistory: [],
  physiologicalConsent: false, previousDecisions: [], session: { sessionId: 's', startedAt: '2026-10-10T18:00:00.000Z', allowPhysiologicalPacing: false }, decisionTimestamp: now, ...overrides,
});

test('maintains with insufficient evaluations', () => assert.equal(calibrate(base({ geminiEvaluations: [evaluation(0.99, 1)] })).reason, 'insufficient_valid_evaluations'));
test('increases for high quality and caps at five', () => { assert.equal(calibrate(base({ geminiEvaluations: [evaluation(.9, 1), evaluation(.9, 2)] })).recommendedDifficulty, 4); assert.equal(calibrate(base({ currentDifficulty: 5, geminiEvaluations: [evaluation(.9, 1), evaluation(.9, 2)] })).recommendedDifficulty, 5); });
test('maintains for moderate quality', () => assert.equal(calibrate(base()).action, 'maintain'));
test('uses only the latest three valid evaluations', () => {
  const decision = calibrate(base({ geminiEvaluations: [evaluation(0.1, 0), evaluation(0.9, 1), evaluation(0.9, 2), evaluation(0.9, 3)] }));
  assert.equal(decision.action, 'increase');
  assert.deepEqual(decision.evidence.evaluationScoresUsed, [0.9, 0.9, 0.9]);
});
test('supports weak quality and reduces at most one', () => { const decision = calibrate(base({ geminiEvaluations: [evaluation(.4, 1), evaluation(.5, 2)], currentDifficulty: 1 })); assert.equal(decision.action, 'support'); assert.equal(decision.recommendedDifficulty, 1); });
test('cooldown preserves current difficulty', () => { const decision = calibrate(base({ geminiEvaluations: [evaluation(.9, 1), evaluation(.9, 2)], previousDecisions: [{ action: 'increase', recommendedDifficulty: 3, timestamp: '2026-10-10T18:59:30.000Z', difficultyChanged: true }] })); assert.equal(decision.reason, 'cooldown_prevents_difficulty_change'); assert.equal(decision.recommendedDifficulty, 3); });
test('no camera remains answer-based', () => assert.equal(calibrate(base({ physiological: undefined })).usedPhysiologicalData, false));
test('denied consent, stale, invalid, low confidence, unstable, and missing baseline do not use physiology', () => {
  const physiological = { availability: { valid: true, measuredAt: '2026-10-10T18:59:50.000Z' }, samples: [{ metric: 'pulseRate' as const, value: 90, confidence: 90, stable: true, measuredAt: '2026-10-10T18:59:50.000Z' }] };
  const baseline = [{ metric: 'pulseRate' as const, value: 60, measuredAt: '2026-10-10T18:00:00.000Z' }];
  const common = { physiological, physiologicalBaselines: baseline, session: { sessionId: 's', startedAt: '2026-10-10T18:00:00.000Z', allowPhysiologicalPacing: true } };
  assert.equal(calibrate(base({ ...common, physiologicalConsent: false })).usedPhysiologicalData, false);
  assert.equal(calibrate(base({ ...common, physiologicalConsent: true, physiological: { ...physiological, availability: { valid: false, measuredAt: now } } })).usedPhysiologicalData, false);
  assert.equal(calibrate(base({ ...common, physiologicalConsent: true, physiological: { ...physiological, samples: [{ ...physiological.samples[0], measuredAt: '2026-10-10T18:00:00.000Z' }] } })).usedPhysiologicalData, false);
  assert.equal(calibrate(base({ ...common, physiologicalConsent: true, physiological: { ...physiological, samples: [{ ...physiological.samples[0], confidence: 20 }] } })).usedPhysiologicalData, false);
  assert.equal(calibrate(base({ ...common, physiologicalConsent: true, physiological: { ...physiological, samples: [{ ...physiological.samples[0], stable: false }] } })).usedPhysiologicalData, false);
  assert.equal(calibrate(base({ ...common, physiologicalConsent: true, physiologicalBaselines: [] })).usedPhysiologicalData, false);
});
test('valid physiology only adds conservative pacing to moderate answer results', () => { const decision = calibrate(base({ physiologicalConsent: true, session: { sessionId: 's', startedAt: '2026-10-10T18:00:00.000Z', allowPhysiologicalPacing: true }, physiological: { availability: { valid: true, measuredAt: '2026-10-10T18:59:50.000Z' }, samples: [{ metric: 'pulseRate', value: 90, confidence: 90, stable: true, measuredAt: '2026-10-10T18:59:50.000Z' }] }, physiologicalBaselines: [{ metric: 'pulseRate', value: 60, measuredAt: '2026-10-10T18:00:00.000Z' }] })); assert.equal(decision.action, 'support'); assert.equal(decision.recommendedDifficulty, 3); assert.equal(decision.usedPhysiologicalData, true); });
test('rejects malformed values and is deterministic without psychological claims', () => { assert.throws(() => calibrate(base({ geminiEvaluations: [evaluation(1.1, 1)] })), CalibrationInputError); assert.throws(() => calibrate(base({ performanceHistory: [{ score: -1, completed: true, recordedAt: now }] })), CalibrationInputError); const input = base(); const first = calibrate(input); assert.deepEqual(first, calibrate(input)); assert.doesNotMatch(JSON.stringify(first), /stress|anxiety|deception|competence/i); });
