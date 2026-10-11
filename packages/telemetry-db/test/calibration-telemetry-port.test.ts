import assert from 'node:assert/strict';
import test from 'node:test';
import { calibrationTelemetryPortFromStore } from '../src/index.js';

test('concrete calibration telemetry port delegates to existing TelemetryStore operations', async () => {
  const calls: string[] = [];
  const store = {
    async insertEvent() { calls.push('event'); return true; },
    async insertDecision() { calls.push('decision'); return false; },
  };
  const port = calibrationTelemetryPortFromStore(store as never);
  assert.equal(await port.insertEvent({} as never), true);
  assert.equal(await port.insertDecision({} as never), false);
  assert.deepEqual(calls, ['event', 'decision']);
});
