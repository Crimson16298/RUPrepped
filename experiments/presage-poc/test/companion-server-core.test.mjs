import assert from 'node:assert/strict';
import test from 'node:test';
import { createCompanionServer } from '../src/companion-server-core.mjs';

const token = 'a'.repeat(32);
const ownerA = 'b'.repeat(64);
const ownerB = 'c'.repeat(64);
function fakeCompanion() { let activeSessionId; const subscribers = new Set(); const stopReasons = []; return {
  stopReasons,
  get activeSessionId() { return activeSessionId; },
  subscribe(callback) { subscribers.add(callback); },
  snapshot() { return { schemaVersion: '1.0.0', type: 'status', sessionId: activeSessionId, status: activeSessionId ? 'warming_up' : 'awaiting_consent' }; },
  async start({ sessionId, consent }) { if (!consent) return { accepted: false, status: 'awaiting_consent' }; if (activeSessionId === sessionId) return { accepted: true, status: 'warming_up', duplicate: true }; if (activeSessionId) return { accepted: false, status: 'session_active_elsewhere' }; activeSessionId = sessionId; for (const fn of subscribers) fn(this.snapshot()); return { accepted: true, status: 'warming_up' }; },
  async stop(reason) { stopReasons.push(reason); activeSessionId = undefined; return this.snapshot(); },
}; }
async function call(handler, { method, url, tokenValue = token, origin = 'http://localhost:5173', body }) {
  let text = ''; let status; const listeners = new Map();
  const request = { method, url, headers: { origin, 'x-presage-capability': tokenValue }, async *[Symbol.asyncIterator]() { if (body) yield Buffer.from(JSON.stringify(body)); }, on() {} };
  const response = { writeHead(value) { status = value; }, end(value = '') { text += value; }, write(value) { text += value; }, on(event, listener) { listeners.set(event, listener); } };
  await handler(request, response); return { get status() { return status; }, get body() { return text; }, close() { listeners.get('close')?.(); } };
}
const startBody = (sessionId = 'ses_1', ownerToken = ownerA, consent = true) => ({ sessionId, consent, ownerToken });
const server = (companion, ownerLeaseMs = 15_000, ownerLeaseGraceMs = 0, onRequest = () => {}) => createCompanionServer({ companion, capabilityToken: token, allowedOrigins: new Set(['http://localhost:5173']), ownerLeaseMs, ownerLeaseGraceMs, onRequest });

test('restricts origins/tokens and rejects cross-session or non-owner stop requests', async () => {
  const companion = fakeCompanion(); const transport = server(companion);
  assert.equal((await call(transport.handler, { method: 'GET', url: '/v1/presage/status', tokenValue: 'wrong' })).status, 403);
  assert.equal((await call(transport.handler, { method: 'GET', url: '/v1/presage/status', origin: 'http://evil.example' })).status, 403);
  assert.equal((await call(transport.handler, { method: 'POST', url: '/v1/presage/start', body: startBody() })).status, 200);
  assert.equal((await call(transport.handler, { method: 'POST', url: '/v1/presage/stop', body: { sessionId: 'ses_2', ownerToken: ownerA } })).status, 403);
  assert.equal((await call(transport.handler, { method: 'POST', url: '/v1/presage/stop', body: { sessionId: 'ses_1', ownerToken: ownerB } })).status, 403);
  assert.equal((await call(transport.handler, { method: 'POST', url: '/v1/presage/stop', body: { sessionId: 'ses_1', ownerToken: ownerA } })).status, 200);
  await transport.close();
});

test('sends SSE events only to the session that opened the stream', async () => {
  const transport = server(fakeCompanion());
  await call(transport.handler, { method: 'POST', url: '/v1/presage/start', body: startBody() });
  const stream = await call(transport.handler, { method: 'GET', url: '/v1/presage/events?sessionId=ses_1' });
  const initial = stream.body;
  transport.publish({ type: 'measurement', sessionId: 'ses_2' });
  assert.equal(stream.body, initial);
  transport.publish({ type: 'measurement', sessionId: 'ses_1' });
  assert.match(stream.body, /"sessionId":"ses_1"/);
  await transport.close();
});

test('independent SSE observer cannot keep the owner camera lease alive', async () => {
  const companion = fakeCompanion(); const transport = server(companion, 60);
  await call(transport.handler, { method: 'POST', url: '/v1/presage/start', body: startBody() });
  const observer = await call(transport.handler, { method: 'GET', url: '/v1/presage/events?sessionId=ses_1' });
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(companion.activeSessionId, undefined);
  assert.deepEqual(companion.stopReasons, ['owner_lease_expired']);
  observer.close(); await transport.close();
});

test('only the owner heartbeat renews a lease; fresh interview requires fresh consent', async () => {
  const companion = fakeCompanion(); const transport = server(companion, 80);
  assert.equal((await call(transport.handler, { method: 'POST', url: '/v1/presage/start', body: startBody('ses_1', ownerA, false) })).status, 400);
  await call(transport.handler, { method: 'POST', url: '/v1/presage/start', body: startBody() });
  assert.equal((await call(transport.handler, { method: 'POST', url: '/v1/presage/heartbeat', body: { sessionId: 'ses_1', ownerToken: ownerB } })).status, 403);
  await new Promise((resolve) => setTimeout(resolve, 45));
  assert.equal((await call(transport.handler, { method: 'POST', url: '/v1/presage/heartbeat', body: { sessionId: 'ses_1', ownerToken: ownerA } })).status, 200);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(companion.activeSessionId, 'ses_1');
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(companion.activeSessionId, undefined);
  assert.equal((await call(transport.handler, { method: 'POST', url: '/v1/presage/start', body: startBody('ses_2', ownerB) })).status, 200);
  await transport.close();
});

test('heartbeat arriving after the base lease but within grace prevents false shutdown; missing heartbeat still expires', async () => {
  const companion = fakeCompanion(); const transport = server(companion, 40, 80);
  await call(transport.handler, { method: 'POST', url: '/v1/presage/start', body: startBody() });
  await new Promise((resolve) => setTimeout(resolve, 55)); // Past the nominal lease, within bounded grace.
  assert.equal((await call(transport.handler, { method: 'POST', url: '/v1/presage/heartbeat', body: { sessionId: 'ses_1', ownerToken: ownerA } })).status, 200);
  await new Promise((resolve) => setTimeout(resolve, 65));
  assert.equal(companion.activeSessionId, 'ses_1');
  await new Promise((resolve) => setTimeout(resolve, 70));
  assert.equal(companion.activeSessionId, undefined);
  assert.deepEqual(companion.stopReasons, ['owner_lease_expired']);
  await transport.close();
});

test('same-session duplicate start is idempotent only for the current owner token', async () => {
  const transport = server(fakeCompanion());
  await call(transport.handler, { method: 'POST', url: '/v1/presage/start', body: startBody() });
  const duplicate = await call(transport.handler, { method: 'POST', url: '/v1/presage/start', body: startBody() });
  const otherOwner = await call(transport.handler, { method: 'POST', url: '/v1/presage/start', body: startBody('ses_1', ownerB) });
  assert.equal(JSON.parse(duplicate.body).duplicate, true);
  assert.equal(otherOwner.status, 409);
  await transport.close();
});

test('request diagnostics expose route and status only, never session or owner credentials', async () => {
  const companion = fakeCompanion(); const diagnostics = [];
  const transport = server(companion, 15_000, 0, (event) => diagnostics.push(event));
  await call(transport.handler, { method: 'POST', url: '/v1/presage/start', body: startBody('ses_private', ownerA) });
  await call(transport.handler, { method: 'POST', url: '/v1/presage/heartbeat', body: { sessionId: 'ses_private', ownerToken: ownerA } });
  await call(transport.handler, { method: 'POST', url: '/v1/presage/stop', body: { sessionId: 'ses_private', ownerToken: ownerA } });
  assert.deepEqual(diagnostics.map(({ route, status }) => ({ route, status })), [
    { route: '/v1/presage/start', status: 200 },
    { route: '/v1/presage/heartbeat', status: 200 },
    { route: '/v1/presage/stop', status: 200 },
  ]);
  assert.equal(JSON.stringify(diagnostics).includes('ses_private'), false);
  assert.equal(JSON.stringify(diagnostics).includes(ownerA), false);
  await transport.close();
});
