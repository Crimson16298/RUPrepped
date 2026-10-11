import assert from 'node:assert/strict';
import test from 'node:test';
import { createSessionMeasurementAdapter } from '../src/session-measurement-adapter.mjs';

const event = {
  source: 'presage-smartspectra', receivedAt: '2026-10-10T19:00:00.000Z',
  samples: [{ metric: 'pulseRate', value: 72, unit: 'bpm', confidence: 90, stable: true }],
};

test('camera data is unavailable until explicit consent and is associated with the active session', () => {
  const adapter = createSessionMeasurementAdapter('ses_active');
  assert.deepEqual(adapter.summarize({ validationCode: 0, metricEvent: event }), { status: 'consent_not_granted' });
  adapter.grantConsent();
  const result = adapter.summarize({ validationCode: 0, metricEvent: event });
  assert.equal(result.status, 'available');
  assert.equal(result.summary.sessionId, 'ses_active');
});

test('revocation, invalid validation, and low-quality measurements never emit a summary', () => {
  const adapter = createSessionMeasurementAdapter('ses_active');
  adapter.grantConsent();
  assert.deepEqual(adapter.summarize({ validationCode: 7, metricEvent: event }), { status: 'measurement_not_valid' });
  assert.deepEqual(adapter.summarize({ validationCode: 0, metricEvent: { ...event, samples: [{ ...event.samples[0], confidence: 20 }] } }), { status: 'measurement_quality_insufficient' });
  adapter.revokeConsent();
  assert.deepEqual(adapter.summarize({ validationCode: 0, metricEvent: event }), { status: 'consent_not_granted' });
});

test('missing camera events are isolated and never throw into an interview flow', () => {
  const adapter = createSessionMeasurementAdapter('ses_active');
  adapter.grantConsent();
  assert.deepEqual(adapter.summarize({ validationCode: 0 }), { status: 'camera_or_measurement_unavailable' });
});
