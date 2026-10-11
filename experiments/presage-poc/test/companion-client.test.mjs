import assert from 'node:assert/strict';
import test from 'node:test';
import { consumeSseBlocks, createPresageCompanionClient } from '../src/companion-client.mjs';

test('parses complete companion SSE events without retaining partial frames', () => {
  const received = [];
  const remainder = consumeSseBlocks('event: status\ndata: {"type":"status"}\n\ndata: {"type":"measurement"}', (event) => received.push(event));
  assert.deepEqual(received, [{ type: 'status' }]);
  assert.equal(remainder, 'data: {"type":"measurement"}');
});

test('uses capability headers only with a loopback companion', async () => {
  const calls = [];
  const client = createPresageCompanionClient({ capabilityToken: 'a'.repeat(32), fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return { ok: true, json: async () => ({ status: 'awaiting_consent' }) };
  } });
  await client.status();
  assert.equal(calls[0].url, 'http://127.0.0.1:8765/v1/presage/status');
  assert.equal(calls[0].options.headers['X-Presage-Capability'], 'a'.repeat(32));
  assert.throws(() => createPresageCompanionClient({ baseUrl: 'https://example.test', capabilityToken: 'a'.repeat(32), fetchImpl: async () => {} }), /loopback/);
  assert.throws(() => createPresageCompanionClient({ baseUrl: 'http://[::1]:8765', capabilityToken: 'a'.repeat(32), fetchImpl: async () => {} }), /loopback/);
});
