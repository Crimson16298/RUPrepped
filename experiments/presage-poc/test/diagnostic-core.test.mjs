import assert from 'node:assert/strict';
import test from 'node:test';
import { discoverCamera, publicDiagnosticReport, runBoundedSdkSession, validateDiagnosticConfiguration } from '../src/diagnostic-core.mjs';
import { classifySmartSpectraError } from '../src/sdk-options.mjs';
import { describeValidationCode, summarizeValidationStatus } from '../src/validation-status.mjs';

const secret = 'never-print-this-realistic-secret';
class FakeSdk {
  constructor({ onStart, cameras = [] } = {}) { this.handlers = new Map(); this.onStart = onStart; this.cameras = cameras; this.startCalls = 0; this.stopCalls = 0; this.destroyCalls = 0; }
  on(event, callback) { this.handlers.set(event, callback); return this; }
  useCamera() { this.usedCamera = true; return this; }
  start() { this.startCalls += 1; this.onStart?.(this); }
  async stopAsync() { this.stopCalls += 1; }
  async destroy() { this.destroyCalls += 1; }
  emit(event, ...args) { this.handlers.get(event)?.(...args); }
}

test('TC01–TC05 validate local configuration without exposing a key', () => {
  assert.equal(validateDiagnosticConfiguration({ envFileExists: false, apiKey: undefined }).reason, 'localEnvMissing');
  assert.equal(validateDiagnosticConfiguration({ envFileExists: true, apiKey: undefined }).reason, 'apiKeyMissing');
  assert.equal(validateDiagnosticConfiguration({ envFileExists: true, apiKey: '   ' }).reason, 'apiKeyMalformed');
  assert.equal(validateDiagnosticConfiguration({ envFileExists: true, apiKey: `'${secret}'` }).reason, 'apiKeyMalformed');
  const valid = validateDiagnosticConfiguration({ envFileExists: true, apiKey: secret });
  assert.equal(valid.status, 'PASS'); assert.equal(valid.sdkReceivesApiKeyViaDocumentedOption, true);
});

test('TC06–TC07 classify every documented SDK error code without guessing', () => {
  assert.equal(classifySmartSpectraError(2), 'authenticationFailed');
  assert.equal(classifySmartSpectraError(1), 'invalidState');
  assert.equal(classifySmartSpectraError(11), 'timestampGap');
  assert.equal(classifySmartSpectraError(99), 'unknownSdkError');
});

test('TC08 camera discovery failure is actionable', () => {
  assert.equal(discoverCamera({ availableCameras: () => [] }).reason, 'cameraUnavailable');
  assert.equal(discoverCamera({ availableCameras: () => { throw Object.assign(new Error(), { code: 7 }); } }).reason, 'cameraDiscoveryFailed');
});

test('TC08 maps SDK input-unavailable startup errors to a camera or permission failure', async () => {
  const sdk = new FakeSdk({ onStart: () => { throw Object.assign(new Error('camera unavailable'), { code: 7 }); } });
  const result = await runBoundedSdkSession({ sdk, cameraSelection: {}, timeoutMs: 100, decodeMetrics: () => ({}) });
  assert.equal(result.reason, 'cameraUnavailableOrPermissionDenied');
  assert.equal(sdk.stopCalls, 1); assert.equal(sdk.destroyCalls, 1);
});

test('validation codes 0, 7, 16, and 17 use shared UI-safe SDK meanings and repeat counts', () => {
  assert.deepEqual(describeValidationCode(0), {
    name: 'ok',
    message: 'Frame passes the SDK readiness checks.',
    action: 'Hold the current position while readings stabilize.',
  });
  assert.deepEqual(describeValidationCode(7), {
    name: 'chestNotVisible',
    message: 'Your upper chest is not visible or is too far away.',
    action: 'Reframe so your upper chest is visible and unobstructed.',
  });
  assert.deepEqual(describeValidationCode(16), {
    name: 'faceTooLow',
    message: 'Your face is too low in the frame.',
    action: 'Raise your face in the frame or adjust the camera angle.',
  });
  assert.deepEqual(describeValidationCode(17), {
    name: 'faceNotForward',
    message: 'Your face is turned or tilted away from the camera.',
    action: 'Face the camera directly.',
  });
  assert.deepEqual(summarizeValidationStatus(new Map([
    [16, { count: 2, hintPresent: true }],
    [7, { count: 3, hintPresent: true }],
  ])).map(({ code, name, count }) => ({ code, name, count })), [
    { code: 7, name: 'chestNotVisible', count: 3 },
    { code: 16, name: 'faceTooLow', count: 2 },
  ]);
});

test('TC09 reports no valid measurements without inventing values', async () => {
  const sdk = new FakeSdk();
  const result = await runBoundedSdkSession({ sdk, cameraSelection: {}, timeoutMs: 5, decodeMetrics: () => ({}) });
  assert.equal(result.status, 'BLOCKED'); assert.equal(result.reason, 'noValidMeasurements'); assert.deepEqual(result.metricTypes, []);
  assert.equal(sdk.stopCalls, 1); assert.equal(sdk.destroyCalls, 1);
});

test('TC10 releases camera resources on cancellation', async () => {
  const controller = new AbortController(); const sdk = new FakeSdk({ onStart: () => controller.abort() });
  const result = await runBoundedSdkSession({ sdk, cameraSelection: {}, timeoutMs: 100, decodeMetrics: () => ({}), signal: controller.signal });
  assert.equal(result.reason, 'sessionCancelled'); assert.equal(sdk.stopCalls, 1); assert.equal(sdk.destroyCalls, 1);
});

test('TC10 releases camera resources after a bounded timeout', async () => {
  const sdk = new FakeSdk();
  const result = await runBoundedSdkSession({ sdk, cameraSelection: {}, timeoutMs: 5, decodeMetrics: () => ({}) });
  assert.equal(result.reason, 'noValidMeasurements');
  assert.equal(result.outcome.kind, 'timeout');
  assert.equal(sdk.stopCalls, 1); assert.equal(sdk.destroyCalls, 1);
});

test('TC11 stops after one nonretryable authentication failure', async () => {
  const sdk = new FakeSdk({ onStart: (instance) => { instance.emit('error', 2, secret, false); instance.emit('error', 2, secret, false); } });
  const result = await runBoundedSdkSession({ sdk, cameraSelection: {}, timeoutMs: 100, decodeMetrics: () => ({}) });
  assert.equal(result.reason, 'authenticationFailure'); assert.equal(sdk.startCalls, 1); assert.equal(sdk.stopCalls, 1); assert.equal(sdk.destroyCalls, 1);
});

test('TC12 public reports never serialize credentials or SDK messages', () => {
  const output = publicDiagnosticReport({
    configuration: { status: 'PASS', apiKey: secret, credential: { exists: true, nonempty: true } },
    sdk: { authorizationHeader: secret },
    camera: {},
    network: { rawUrl: secret },
    session: { events: [{ message: secret, authorization: secret }], validationSummary: [{ code: 7, message: secret, action: secret }] },
  });
  assert.doesNotMatch(output, new RegExp(secret));
});
