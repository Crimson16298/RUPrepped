import assert from 'node:assert/strict';
import test from 'node:test';
import { buildShadowComparison, type CalibrationCliResponse, type ShadowComparisonContext } from '../src/index.js';

const context: ShadowComparisonContext = {
  sessionId: 'ses_example', questionId: 'question-1', answerId: 'answer-1',
  pythonSelectedDifficulty: 3, schemaVersion: '1.0.0',
};
const success = (difficulty: number): CalibrationCliResponse => ({
  ok: true,
  result: {
    decision: { recommendedDifficulty: difficulty as 1 | 2 | 3 | 4 | 5 } as never,
    camera: 'not_provided_or_unavailable', telemetry: 'not_configured',
  },
});

test('shadow comparison records agreement without changing Python authority', () => {
  const record = buildShadowComparison(context, { status: 'completed', durationMs: 14, response: success(3) });
  assert.equal(record.nodeExecutionStatus, 'completed');
  assert.equal(record.agrees, true);
  assert.equal(record.authoritativeDifficulty, 3);
});

test('shadow comparison records disagreement without applying the Node recommendation', () => {
  const record = buildShadowComparison(context, { status: 'completed', durationMs: 14, response: success(4) });
  assert.equal(record.agrees, false);
  assert.equal(record.nodeRecommendedDifficulty, 4);
  assert.equal(record.authoritativeDifficulty, 3);
});

test('shadow comparison isolates timeout, malformed response, and worker failure', () => {
  assert.equal(buildShadowComparison(context, { status: 'timeout', durationMs: 2000 }).nodeExecutionStatus, 'timeout');
  assert.equal(buildShadowComparison(context, { status: 'completed', durationMs: 2, response: null as unknown as CalibrationCliResponse }).nodeExecutionStatus, 'malformed_response');
  assert.equal(buildShadowComparison(context, { status: 'completed', durationMs: 2, response: { ok: false, error: 'calibration_error' } }).nodeExecutionStatus, 'calibration_error');
});
