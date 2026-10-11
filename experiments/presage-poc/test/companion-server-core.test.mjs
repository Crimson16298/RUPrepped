import assert from 'node:assert/strict';
import test from 'node:test';
import { createCompanionServer } from '../src/companion-server-core.mjs';

const token = 'a'.repeat(32);
function fakeCompanion() { let activeSessionId; const subscribers = new Set(); return {
  get activeSessionId() { return activeSessionId; }, subscribe(callback) { subscribers.add(callback); }, snapshot() { return { schemaVersion: '1.0.0', type: 'status', sessionId: activeSessionId, status: activeSessionId ? 'warming_up' : 'awaiting_consent' }; },
  async start({ sessionId }) { activeSessionId = sessionId; for (const fn of subscribers) fn(this.snapshot()); return { accepted: true, status: 'warming_up' }; }, async stop() { activeSessionId = undefined; return this.snapshot(); },
}; }
async function call(handler, { method, url, tokenValue = token, origin = 'http://localhost:5173', body }) {
  let text = ''; let status;
  const request = { method, url, headers: { origin, 'x-presage-capability': tokenValue }, async *[Symbol.asyncIterator]() { if (body) yield Buffer.from(JSON.stringify(body)); }, on() {} };
  const response = { writeHead(value) { status = value; }, end(value = '') { text += value; }, write(value) { text += value; } };
  await handler(request, response); return { get status() { return status; }, get body() { return text; } };
}

test('restricts origins/tokens and rejects cross-session stop requests', async () => {
  const transport = createCompanionServer({ companion: fakeCompanion(), capabilityToken: token, allowedOrigins: new Set(['http://localhost:5173']) });
  assert.equal((await call(transport.handler, { method: 'GET', url: '/v1/presage/status', tokenValue: 'wrong' })).status, 403);
  assert.equal((await call(transport.handler, { method: 'GET', url: '/v1/presage/status', origin: 'http://evil.example' })).status, 403);
  assert.equal((await call(transport.handler, { method: 'POST', url: '/v1/presage/start', body: { sessionId: 'ses_1', consent: true } })).status, 200);
  assert.equal((await call(transport.handler, { method: 'POST', url: '/v1/presage/stop', body: { sessionId: 'ses_2' } })).status, 403);
  await transport.close();
});

test('sends SSE events only to the session that opened the stream', async () => {
  const transport = createCompanionServer({ companion: fakeCompanion(), capabilityToken: token, allowedOrigins: new Set(['http://localhost:5173']) });
  await call(transport.handler, { method: 'POST', url: '/v1/presage/start', body: { sessionId: 'ses_1', consent: true } });
  const stream = await call(transport.handler, { method: 'GET', url: '/v1/presage/events?sessionId=ses_1' });
  const initial = stream.body;
  transport.publish({ type: 'measurement', sessionId: 'ses_2' });
  assert.equal(stream.body, initial);
  transport.publish({ type: 'measurement', sessionId: 'ses_1' });
  assert.match(stream.body, /"sessionId":"ses_1"/);
  await transport.close();
});
