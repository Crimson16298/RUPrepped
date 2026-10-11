import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';

const json = (response, status, value) => { response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(value)); };
const validSessionId = (value) => typeof value === 'string' && value.trim().length > 0;
const validOwnerToken = (value) => typeof value === 'string' && value.length >= 32 && value.length <= 128;
const matches = (left, right) => {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
};

/** Companion HTTP lifecycle. Camera ownership is independent from diagnostic SSE observers. */
export function createCompanionServer({ companion, capabilityToken, allowedOrigins, ownerLeaseMs = 15_000, ownerLeaseGraceMs = 60_000, onRequest = () => {} }) {
  if (typeof capabilityToken !== 'string' || capabilityToken.length < 32) throw new TypeError('A 32-character local capability token is required.');
  if (!Number.isFinite(ownerLeaseMs) || ownerLeaseMs < 1) throw new TypeError('A positive owner lease is required.');
  if (!Number.isFinite(ownerLeaseGraceMs) || ownerLeaseGraceMs < 0) throw new TypeError('A nonnegative owner lease grace period is required.');
  const clients = new Map();
  const owners = new Map();
  let lifecycleTail = Promise.resolve();
  const serialize = (operation) => {
    const result = lifecycleTail.then(operation, operation);
    lifecycleTail = result.then(() => undefined, () => undefined);
    return result;
  };
  const publish = (event) => {
    const frame = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
    for (const [client, sessionId] of clients) if (event.sessionId === sessionId) client.write(frame);
  };
  companion.subscribe?.(publish);
  const originalStart = companion.start.bind(companion);
  const originalStop = companion.stop.bind(companion);
  const authorized = (request) => matches(request.headers['x-presage-capability'], capabilityToken);
  const originAllowed = (request) => { const origin = request.headers.origin; return typeof origin === 'string' && allowedOrigins.has(origin); };
  const readJson = async (request) => { let body = ''; for await (const chunk of request) { body += chunk; if (body.length > 8_192) throw new Error('request_too_large'); } return JSON.parse(body || '{}'); };
  const clearOwner = (sessionId) => {
    const owner = owners.get(sessionId);
    if (owner) clearTimeout(owner.timer);
    owners.delete(sessionId);
  };
  const renewOwner = (sessionId, ownerToken) => {
    clearOwner(sessionId);
    // The short heartbeat interval remains 4s. Grace tolerates browser timer
    // throttling/background scheduling while keeping orphan capture bounded.
    const expiresAt = Date.now() + ownerLeaseMs + ownerLeaseGraceMs;
    const timer = setTimeout(() => {
      void serialize(async () => {
        const current = owners.get(sessionId);
        if (!current || current.ownerToken !== ownerToken || Date.now() < current.expiresAt) return;
        clearOwner(sessionId);
        if (companion.activeSessionId === sessionId) await originalStop('owner_lease_expired');
      });
    }, ownerLeaseMs + ownerLeaseGraceMs);
    timer.unref?.();
    owners.set(sessionId, { ownerToken, expiresAt, timer });
  };

  const handler = async (request, response) => {
    const origin = request.headers.origin;
    if (request.method === 'OPTIONS' && originAllowed(request)) { response.writeHead(204, { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'Content-Type, X-Presage-Capability', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', Vary: 'Origin' }); response.end(); return; }
    if (!originAllowed(request) || !authorized(request)) { json(response, 403, { error: 'unauthorized' }); return; }
    const headers = { 'Access-Control-Allow-Origin': origin, Vary: 'Origin', 'Cache-Control': 'no-store' };
    try {
      if (request.method === 'GET' && request.url === '/v1/presage/status') { response.writeHead(200, { ...headers, 'Content-Type': 'application/json' }); response.end(JSON.stringify(companion.snapshot())); return; }
      if (request.method === 'POST' && request.url === '/v1/presage/start') {
        const body = await readJson(request);
        if (!validSessionId(body.sessionId) || body.consent !== true || !validOwnerToken(body.ownerToken)) { json(response, 400, { error: 'invalid_start_request' }); return; }
        const result = await serialize(async () => {
          if (companion.activeSessionId && companion.activeSessionId !== body.sessionId) return { accepted: false, status: 'session_active_elsewhere' };
          const priorOwner = owners.get(body.sessionId);
          if (priorOwner && !matches(priorOwner.ownerToken, body.ownerToken)) return { accepted: false, status: 'session_active_elsewhere' };
          const started = await originalStart(body);
          if (started.accepted) renewOwner(body.sessionId, body.ownerToken);
          else clearOwner(body.sessionId);
          return started;
        });
        const statusCode = result.accepted ? 200 : 409;
        onRequest({ method: 'POST', route: '/v1/presage/start', status: statusCode, accepted: Boolean(result.accepted), duplicate: Boolean(result.duplicate) });
        response.writeHead(statusCode, { ...headers, 'Content-Type': 'application/json' }); response.end(JSON.stringify(result)); return;
      }
      if (request.method === 'POST' && request.url === '/v1/presage/heartbeat') {
        const body = await readJson(request);
        if (!validSessionId(body.sessionId) || !validOwnerToken(body.ownerToken)) { json(response, 400, { error: 'invalid_heartbeat_request' }); return; }
        const renewed = await serialize(async () => {
          const owner = owners.get(body.sessionId);
          if (!owner || !matches(owner.ownerToken, body.ownerToken) || companion.activeSessionId !== body.sessionId) return false;
          renewOwner(body.sessionId, body.ownerToken); return true;
        });
        if (!renewed) { onRequest({ method: 'POST', route: '/v1/presage/heartbeat', status: 403, renewed: false }); json(response, 403, { error: 'session_not_owned' }); return; }
        onRequest({ method: 'POST', route: '/v1/presage/heartbeat', status: 200, renewed: true });
        response.writeHead(200, { ...headers, 'Content-Type': 'application/json' }); response.end(JSON.stringify({ renewed: true })); return;
      }
      if (request.method === 'POST' && request.url === '/v1/presage/stop') {
        const body = await readJson(request);
        if (!validSessionId(body.sessionId) || !validOwnerToken(body.ownerToken)) { json(response, 400, { error: 'invalid_stop_request' }); return; }
        const result = await serialize(async () => {
          const owner = owners.get(body.sessionId);
          if (body.sessionId !== companion.activeSessionId || !owner || !matches(owner.ownerToken, body.ownerToken)) return null;
          clearOwner(body.sessionId);
          return originalStop('owner_stopped');
        });
        if (!result) { onRequest({ method: 'POST', route: '/v1/presage/stop', status: 403, stopped: false }); json(response, 403, { error: 'session_not_owned' }); return; }
        onRequest({ method: 'POST', route: '/v1/presage/stop', status: 200, stopped: true, cleanup: result.cleanup ?? 'unknown' });
        response.writeHead(200, { ...headers, 'Content-Type': 'application/json' }); response.end(JSON.stringify(result)); return;
      }
      if (request.method === 'GET' && request.url?.startsWith('/v1/presage/events?')) {
        const sessionId = new URL(request.url, 'http://127.0.0.1').searchParams.get('sessionId');
        if (sessionId !== companion.activeSessionId) { onRequest({ method: 'GET', route: '/v1/presage/events', status: 403, connected: false }); json(response, 403, { error: 'session_not_active' }); return; }
        response.writeHead(200, { ...headers, 'Content-Type': 'text/event-stream', Connection: 'keep-alive' });
        onRequest({ method: 'GET', route: '/v1/presage/events', status: 200, connected: true });
        clients.set(response, sessionId);
        response.write(`event: status\ndata: ${JSON.stringify(companion.snapshot())}\n\n`);
        response.on?.('close', () => {
          clients.delete(response);
        });
        return;
      }
      json(response, 404, { error: 'not_found' });
    } catch { json(response, 400, { error: 'invalid_request' }); }
  };
  const server = createServer(handler);
  return { server, handler, publish, close: async () => { for (const sessionId of owners.keys()) clearOwner(sessionId); await serialize(() => originalStop('server_shutdown')); for (const client of clients.keys()) client.end(); clients.clear(); if (server.listening) await new Promise((resolve) => server.close(resolve)); } };
}
