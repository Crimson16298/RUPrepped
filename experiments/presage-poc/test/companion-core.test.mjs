import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { createPresageCompanion } from '../src/companion-core.mjs';

class FakeSdk extends EventEmitter { useCamera() {} start() { this.emit('processingStatus', 3); } async stopAsync() {} async destroy() {} }
const decoded = { cardio: { pulseRate: [{ value: 72, confidence: 90, stable: true }] } };

test('requires consent and emits only session-associated, quality-filtered SDK measurements', async () => {
  const events = []; let sdk;
  const companion = createPresageCompanion({ createSdk: () => (sdk = new FakeSdk()), availableCameras: () => [{}], decodeMetrics: () => decoded, cameraSelection: 'default', onEvent: (event) => events.push(event), clock: () => '2026-10-11T03:00:00.000Z' });
  assert.deepEqual(await companion.start({ sessionId: 'ses_1', consent: false }), { accepted: false, status: 'awaiting_consent' });
  await companion.start({ sessionId: 'ses_1', consent: true });
  sdk.emit('validationStatus', 7);
  sdk.emit('validationStatus', 7);
  sdk.emit('validationStatus', 0);
  assert.deepEqual(events.filter((event) => event.type === 'status' && event.validationCode !== undefined).map(({ status, validationCode }) => ({ status, validationCode })), [
    { status: 'quality_insufficient', validationCode: 7 },
    { status: 'warming_up', validationCode: 0 },
  ]);
  assert.equal(companion.snapshot().validationCode, 0);
  sdk.emit('metrics', Buffer.from([]), 123);
  assert.deepEqual(events.find((event) => event.type === 'diagnostic'), {
    schemaVersion: '1.0.0',
    emittedAt: '2026-10-11T03:00:00.000Z',
    type: 'diagnostic',
    sessionId: 'ses_1',
    kind: 'sdk_metrics_callback',
    callbackCount: 1,
    validationCode: 0,
    supportedMetricCount: 1,
    outcome: 'available',
  });
  const measurement = events.find((event) => event.type === 'measurement');
  assert.equal(measurement.sessionId, 'ses_1');
  assert.deepEqual(measurement.metrics[0], { metric: 'pulseRate', value: 72, unit: 'bpm', confidence: 90, stable: true, measuredAt: '2026-10-11T03:00:00.000Z' });
});

test('does not mark a metric callback valid when the SDK validation code is nonzero', async () => {
  const events = []; let sdk;
  const companion = createPresageCompanion({ createSdk: () => (sdk = new FakeSdk()), availableCameras: () => [{}], decodeMetrics: () => decoded, cameraSelection: 'default', onEvent: (event) => events.push(event) });
  await companion.start({ sessionId: 'ses_quality', consent: true });

  sdk.emit('validationStatus', 17);
  sdk.emit('metrics', Buffer.from([]), 1);
  assert.equal(events.find((event) => event.type === 'diagnostic')?.outcome, 'measurement_not_valid');
  assert.equal(events.some((event) => event.type === 'measurement'), false);

  sdk.emit('validationStatus', 0);
  sdk.emit('metrics', Buffer.from([]), 2);
  const measurement = events.find((event) => event.type === 'measurement');
  assert.equal(measurement?.quality.validationCode, 0);
  assert.equal(measurement?.metrics[0].value, 72);
});

test('isolates invalid quality, camera errors, duplicate starts, and consent revocation', async () => {
  const events = []; let sdk;
  const companion = createPresageCompanion({ createSdk: () => (sdk = new FakeSdk()), availableCameras: () => [{}], decodeMetrics: () => ({ cardio: { pulseRate: [{ value: 72, confidence: 20, stable: true }] } }), cameraSelection: 'default', onEvent: (event) => events.push(event) });
  await companion.start({ sessionId: 'ses_1', consent: true });
  assert.equal((await companion.start({ sessionId: 'ses_1', consent: true })).duplicate, true);
  assert.equal((await companion.start({ sessionId: 'ses_2', consent: true })).status, 'session_active_elsewhere');
  sdk.emit('validationStatus', 0);
  sdk.emit('metrics', Buffer.from([]), 1);
  assert.equal(events.find((event) => event.type === 'diagnostic')?.outcome, 'measurement_quality_insufficient');
  assert.equal(companion.snapshot().status, 'quality_insufficient');
  await companion.stop('consent_revoked');
  assert.equal(companion.snapshot().status, 'stopped');
});

test('reports camera unavailability without retaining a session and releases SDK resources on stop', async () => {
  const unavailable = createPresageCompanion({ createSdk: () => new FakeSdk(), availableCameras: () => [], decodeMetrics: () => ({}), cameraSelection: 'default' });
  assert.deepEqual(await unavailable.start({ sessionId: 'ses_1', consent: true }), { accepted: false, status: 'unavailable' });
  assert.equal(unavailable.activeSessionId, undefined);

  const events = []; let stops = 0; let destroys = 0;
  const companion = createPresageCompanion({
    createSdk: () => ({ on() {}, useCamera() {}, start() {}, async stopAsync() { stops += 1; }, async destroy() { destroys += 1; } }),
    availableCameras: () => [{}], decodeMetrics: () => ({}), cameraSelection: 'default', onEvent: (event) => events.push(event),
  });
  await companion.start({ sessionId: 'ses_1', consent: true });
  await companion.stop('consent_revoked');
  assert.equal(stops, 1);
  assert.equal(destroys, 1);
  assert.equal(events.at(-1).sessionId, 'ses_1');
  assert.equal(events.at(-1).status, 'stopped');
});

test('emits sanitized SDK cleanup failure classifications without claiming successful device cleanup', async () => {
  const events = [];
  const companion = createPresageCompanion({
    createSdk: () => ({ on() {}, useCamera() {}, start() {}, async stopAsync() { throw new TypeError('private SDK detail'); }, async destroy() {} }),
    availableCameras: () => [{}], decodeMetrics: () => ({}), cameraSelection: 'default', onEvent: (event) => events.push(event),
  });
  await companion.start({ sessionId: 'ses_cleanup', consent: true });
  const stopped = await companion.stop('consent_revoked');
  const diagnostic = events.find((event) => event.kind === 'sdk_cleanup');
  assert.equal(diagnostic.operation, 'stopAsync');
  assert.equal(diagnostic.errorClass, 'TypeError');
  assert.equal(JSON.stringify(diagnostic).includes('private SDK detail'), false);
  assert.equal(stopped.cleanup, 'failed');
  assert.equal(events.at(-1).cleanup, 'failed');
});

test('ignores delayed callbacks from a stopped SDK after another session starts', async () => {
  const events = []; const instances = [];
  const companion = createPresageCompanion({
    createSdk: () => { const sdk = new FakeSdk(); instances.push(sdk); return sdk; },
    availableCameras: () => [{}], decodeMetrics: () => decoded, cameraSelection: 'default', onEvent: (event) => events.push(event),
  });
  await companion.start({ sessionId: 'ses_old', consent: true });
  await companion.stop();
  await companion.start({ sessionId: 'ses_new', consent: true });
  instances[0].emit('metrics', Buffer.from([]), 1);
  assert.equal(events.some((event) => event.type === 'measurement' && event.sessionId === 'ses_old'), false);
});
