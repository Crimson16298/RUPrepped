import assert from 'node:assert/strict';
import test from 'node:test';
import { coordinateInterviewTurn, handleWorkerRequest, type IntegrationRequest, type TelemetryPort } from '../src/index.js';

const request = (overrides: Partial<IntegrationRequest['calibration']> = {}): IntegrationRequest => ({
  calibration: {
    currentDifficulty: 3,
    geminiEvaluations: [
      { score: 0.9, valid: true, completedAt: '2026-10-10T18:01:00.000Z' },
      { score: 0.9, valid: true, completedAt: '2026-10-10T18:02:00.000Z' },
    ], performanceHistory: [], physiologicalConsent: false, previousDecisions: [],
    session: { sessionId: 'session-1', startedAt: '2026-10-10T18:00:00.000Z', allowPhysiologicalPacing: false },
    decisionTimestamp: '2026-10-10T19:00:00.000Z', ...overrides,
  },
  telemetry: {
    event: { eventId: 'event-1', sessionId: 'session-1', timestamp: '2026-10-10T19:00:00.000Z', type: 'gemini_evaluation', payload: { score: .9 }, schemaVersion: '1', idempotencyKey: 'evaluation-1' },
    decisionId: 'decision-1', decisionIdempotencyKey: 'decision-1',
  },
});

const port = (eventResult = true, decisionResult = true): TelemetryPort => ({
  async insertEvent() { return eventResult; },
  async insertDecision() { return decisionResult; },
});

test('coordinates normal Gemini answer scoring with non-blocking telemetry', async () => {
  const result = await coordinateInterviewTurn(request(), port());
  assert.equal(result.decision.action, 'increase');
  assert.equal(result.decision.recommendedDifficulty, 4);
  assert.equal(result.telemetry, 'persisted');
  assert.equal(result.camera, 'not_provided_or_unavailable');
});

test('keeps camera failure and denied consent out of difficulty scoring', async () => {
  const unavailable = await coordinateInterviewTurn(request({ physiological: { availability: { valid: false, measuredAt: '2026-10-10T18:59:00.000Z' }, samples: [] } }), port());
  assert.equal(unavailable.camera, 'consent_not_granted');
  assert.equal(unavailable.decision.action, 'increase');
});

test('reports duplicate telemetry and database failure without interrupting calibration', async () => {
  assert.equal((await coordinateInterviewTurn(request(), port(false, true))).telemetry, 'duplicate');
  const failed: TelemetryPort = { async insertEvent() { throw new Error('offline'); }, async insertDecision() { return true; } };
  const result = await coordinateInterviewTurn(request(), failed);
  assert.equal(result.telemetry, 'unavailable');
  assert.equal(result.decision.recommendedDifficulty, 4);
});

test('worker boundary returns structured failures for malformed and invalid requests', async () => {
  assert.deepEqual(await handleWorkerRequest(null), { ok: false, error: 'invalid_request' });
  assert.deepEqual(await handleWorkerRequest({ calibration: {} }), { ok: false, error: 'calibration_error' });
  const result = await handleWorkerRequest(request());
  assert.equal(result.ok, true);
});
