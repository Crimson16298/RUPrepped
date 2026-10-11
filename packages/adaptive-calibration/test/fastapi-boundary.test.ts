import assert from 'node:assert/strict';
import test from 'node:test';
import { runCalibrationCli, toExistingFrontendDifficultyDecision, type WorkerResponse } from '../src/index.js';

const validRequest = (scores = [90, 90]) => ({
  schemaVersion: '1.0.0',
  calibration: {
    currentDifficulty: 3,
    geminiEvaluations: scores.map((score, index) => ({ score, valid: true, completedAt: `2026-10-10T18:0${index + 1}:00.000Z` })),
    performanceHistory: [],
    physiologicalConsent: false,
    previousDecisions: [],
    session: { sessionId: 'ses_example', startedAt: '2026-10-10T18:00:00.000Z', allowPhysiologicalPacing: false },
    decisionTimestamp: '2026-10-10T19:00:00.000Z',
  },
});

test('CLI boundary normalizes FastAPI 0–100 Gemini scores and returns a valid decision', async () => {
  const result = await runCalibrationCli(JSON.stringify(validRequest()));
  assert.equal(result.exitCode, 0);
  assert.equal(result.response.ok, true);
  if (result.response.ok) {
    assert.equal(result.response.result.decision.action, 'increase');
    assert.deepEqual(result.response.result.decision.evidence.evaluationScoresUsed, [0.9, 0.9]);
  }
});

test('CLI boundary safely rejects malformed JSON, missing fields, unsupported versions, and invalid scores', async () => {
  assert.deepEqual(await runCalibrationCli('{'), { response: { ok: false, error: 'malformed_json' }, exitCode: 2, diagnostic: 'malformed_json' });
  assert.deepEqual((await runCalibrationCli(JSON.stringify({ schemaVersion: '1.0.0' }))).response, { ok: false, error: 'invalid_request' });
  assert.deepEqual((await runCalibrationCli(JSON.stringify({ ...validRequest(), schemaVersion: '2.0.0' }))).response, { ok: false, error: 'unsupported_schema_version' });
  const invalidScore = validRequest(); invalidScore.calibration.geminiEvaluations[0]!.score = 101;
  assert.deepEqual((await runCalibrationCli(JSON.stringify(invalidScore))).response, { ok: false, error: 'invalid_request' });
});

test('insufficient valid history keeps difficulty unchanged', async () => {
  const result = await runCalibrationCli(JSON.stringify(validRequest([95])));
  assert.equal(result.response.ok, true);
  if (result.response.ok) {
    assert.equal(result.response.result.decision.action, 'maintain');
    assert.equal(result.response.result.decision.reason, 'insufficient_valid_evaluations');
  }
});

test('legacy frontend mapping preserves actual difficulty movement', () => {
  const base = { reason: 'x', usedPhysiologicalData: false, evidence: {} as never, timestamp: '2026-10-10T19:00:00.000Z', contractVersion: '1.0.0' as const };
  assert.equal(toExistingFrontendDifficultyDecision({ ...base, action: 'increase', recommendedDifficulty: 4 }, 3), 'increase');
  assert.equal(toExistingFrontendDifficultyDecision({ ...base, action: 'support', recommendedDifficulty: 2 }, 3), 'decrease');
  assert.equal(toExistingFrontendDifficultyDecision({ ...base, action: 'support', recommendedDifficulty: 3 }, 3), 'maintain');
  assert.equal(toExistingFrontendDifficultyDecision({ ...base, action: 'pause', recommendedDifficulty: 3 }, 3), 'maintain');
});

test('worker failure returns a non-sensitive failure response', async () => {
  const failingWorker = async (): Promise<WorkerResponse> => ({ ok: false, error: 'calibration_error' });
  const result = await runCalibrationCli(JSON.stringify(validRequest()), failingWorker);
  assert.deepEqual(result.response, { ok: false, error: 'calibration_error' });
  assert.equal(result.exitCode, 3);
});
