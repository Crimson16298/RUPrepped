import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';

const json = (response, status, value) => { response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(value)); };
const validSessionId = (value) => typeof value === 'string' && value.trim().length > 0;

export function createCompanionServer({ companion, capabilityToken, allowedOrigins }) {
  if (typeof capabilityToken !== 'string' || capabilityToken.length < 32) throw new TypeError('A 32-character local capability token is required.');
  const clients = new Map();
  const publish = (event) => {
    const frame = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
    for (const [client, sessionId] of clients) if (event.sessionId === sessionId) client.write(frame);
  };
  companion.subscribe?.(publish);
  const originalStart = companion.start.bind(companion);
  const originalStop = companion.stop.bind(companion);
  // The companion receives this callback at construction in production; tests can call publish via wrapper methods.
  const authorized = (request) => {
    const supplied = request.headers['x-presage-capability'];
    if (typeof supplied !== 'string') return false;
    const actual = Buffer.from(supplied);
    const expected = Buffer.from(capabilityToken);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  };
  const originAllowed = (request) => { const origin = request.headers.origin; return typeof origin === 'string' && allowedOrigins.has(origin); };
  const readJson = async (request) => { let body = ''; for await (const chunk of request) body += chunk; return JSON.parse(body || '{}'); };

  const handler = async (request, response) => {
    const origin = request.headers.origin;
    if (request.method === 'OPTIONS' && originAllowed(request)) { response.writeHead(204, { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'Content-Type, X-Presage-Capability', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', Vary: 'Origin' }); response.end(); return; }
    if (!originAllowed(request) || !authorized(request)) { json(response, 403, { error: 'unauthorized' }); return; }
    const headers = { 'Access-Control-Allow-Origin': origin, Vary: 'Origin', 'Cache-Control': 'no-store' };
    try {
      if (request.method === 'GET' && request.url === '/v1/presage/status') { response.writeHead(200, { ...headers, 'Content-Type': 'application/json' }); response.end(JSON.stringify(companion.snapshot())); return; }
      if (request.method === 'POST' && request.url === '/v1/presage/start') { const body = await readJson(request); if (!validSessionId(body.sessionId) || body.consent !== true) { json(response, 400, { error: 'invalid_start_request' }); return; } const result = await originalStart(body); response.writeHead(result.accepted ? 200 : 409, { ...headers, 'Content-Type': 'application/json' }); response.end(JSON.stringify(result)); return; }
      if (request.method === 'POST' && request.url === '/v1/presage/stop') { const body = await readJson(request); if (!validSessionId(body.sessionId) || body.sessionId !== companion.activeSessionId) { json(response, 403, { error: 'session_not_active' }); return; } const result = await originalStop('consent_revoked'); response.writeHead(200, { ...headers, 'Content-Type': 'application/json' }); response.end(JSON.stringify(result)); return; }
      if (request.method === 'GET' && request.url?.startsWith('/v1/presage/events?')) { const sessionId = new URL(request.url, 'http://127.0.0.1').searchParams.get('sessionId'); if (sessionId !== companion.activeSessionId) { json(response, 403, { error: 'session_not_active' }); return; } response.writeHead(200, { ...headers, 'Content-Type': 'text/event-stream', Connection: 'keep-alive' }); clients.set(response, sessionId); response.write(`event: status\ndata: ${JSON.stringify(companion.snapshot())}\n\n`); request.on('close', () => clients.delete(response)); return; }
      json(response, 404, { error: 'not_found' });
    } catch { json(response, 400, { error: 'invalid_request' }); }
  };
  const server = createServer(handler);
  return { server, handler, publish, close: async () => { await originalStop('server_shutdown'); for (const client of clients.keys()) client.end(); clients.clear(); if (server.listening) await new Promise((resolve) => server.close(resolve)); } };
}
