const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost']);

function localBaseUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !LOCAL_HOSTS.has(url.hostname) || url.username || url.password) {
    throw new TypeError('The Presage companion URL must be an unauthenticated HTTP loopback URL.');
  }
  return url.toString().replace(/\/$/, '');
}

function requireToken(value) {
  if (typeof value !== 'string' || value.length < 32) throw new TypeError('A 32-character local capability token is required.');
  return value;
}

/** Parse complete SSE blocks only; incomplete input is returned to the caller's buffer. */
export function consumeSseBlocks(buffer, onEvent) {
  let remainder = buffer;
  while (true) {
    const boundary = remainder.indexOf('\n\n');
    if (boundary === -1) return remainder;
    const block = remainder.slice(0, boundary);
    remainder = remainder.slice(boundary + 2);
    const data = block.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('\n');
    if (!data) continue;
    try { onEvent(JSON.parse(data)); } catch { /* Ignore malformed SSE data from an untrusted local process. */ }
  }
}

/** Browser-safe client for the loopback companion. It never accesses camera frames. */
export function createPresageCompanionClient({ baseUrl = 'http://127.0.0.1:8765', capabilityToken, fetchImpl = globalThis.fetch }) {
  const origin = localBaseUrl(baseUrl);
  const token = requireToken(capabilityToken);
  if (typeof fetchImpl !== 'function') throw new TypeError('A fetch implementation is required.');
  const headers = { 'X-Presage-Capability': token };

  async function request(path, options = {}) {
    const response = await fetchImpl(`${origin}${path}`, { ...options, headers: { ...headers, ...options.headers } });
    if (!response.ok) throw new Error(`companion_request_failed_${response.status}`);
    return response;
  }

  return {
    async status() { return (await request('/v1/presage/status')).json(); },
    async start(sessionId) {
      return (await request('/v1/presage/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId, consent: true }) })).json();
    },
    async stop(sessionId) {
      return (await request('/v1/presage/stop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId }) })).json();
    },
    async subscribe(sessionId, { onEvent, signal } = {}) {
      if (typeof onEvent !== 'function') throw new TypeError('onEvent is required.');
      const response = await request(`/v1/presage/events?sessionId=${encodeURIComponent(sessionId)}`, { headers: { Accept: 'text/event-stream' }, signal });
      if (!response.body) throw new Error('companion_stream_unavailable');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let remainder = '';
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          remainder = consumeSseBlocks(remainder + decoder.decode(value, { stream: true }), onEvent);
        }
        consumeSseBlocks(remainder + decoder.decode(), onEvent);
      } finally { reader.releaseLock(); }
    },
  };
}
