import assert from 'node:assert/strict';
import test from 'node:test';
import { extractMetricSamples, normalizeMetricEvent } from '../src/metric-extraction.mjs';

test('extracts only documented samples that exist in an SDK metrics payload', () => {
  assert.deepEqual(extractMetricSamples({
    breathing: { rate: [{ value: 14.2, confidence: 90, stable: true, timestamp: 123 }] },
    cardio: {
      pulseRate: [{ value: 72, confidence: 80, stable: true, timestamp: 456 }],
      hrv: [{ rmssd: 35, confidence: 70, stable: true, timestamp: 789 }],
    },
  }), [
    { metric: 'breathingRate', value: 14.2, unit: 'breaths/min', confidence: 90, stable: true, timestampUs: 123 },
    { metric: 'pulseRate', value: 72, unit: 'bpm', confidence: 80, stable: true, timestampUs: 456 },
    { metric: 'hrvRmssd', value: 35, confidence: 70, stable: true, timestampUs: 789 },
  ]);
});

test('does not fabricate missing or malformed samples', () => {
  assert.deepEqual(extractMetricSamples({ cardio: { pulseRate: [{ value: 'unknown' }] } }), []);
});

test('normalizes only real decoded readings into the stable Person 3 event shape', () => {
  assert.deepEqual(normalizeMetricEvent({ cardio: { pulseRate: [{ value: 72, confidence: 88, stable: true, timestamp: 456 }] } }, 123, '2026-10-10T19:00:00.000Z'), {
    source: 'presage-smartspectra', sdkEventTimestampUs: 123, receivedAt: '2026-10-10T19:00:00.000Z',
    samples: [{ metric: 'pulseRate', value: 72, unit: 'bpm', confidence: 88, stable: true, timestampUs: 456 }],
  });
  assert.equal(normalizeMetricEvent({}, 123, '2026-10-10T19:00:00.000Z'), undefined);
});
