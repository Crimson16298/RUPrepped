import assert from "node:assert/strict";
import test from "node:test";
import { consumeSseBlocks, createPresageCompanionClient } from "../../packages/presage-companion-client/src/index.mjs";
import { createPresageOwnerStopper, createPresageOwnerToken, registerPresagePageLifecycle, registerPresageVisibilityHeartbeat } from "../src/hooks/presageLifecycle.mjs";

test("browser client confirms the actual SSE response and parses a measurement event", async () => {
  const event = {
    schemaVersion: "1.0.0", emittedAt: "2026-10-11T04:00:00.000Z", type: "measurement", sessionId: "session-test",
    observedAt: "2026-10-11T04:00:00.000Z", metrics: [], quality: { validationCode: 0, confidence: 90, stable: true },
  };
  const stream = new ReadableStream({ start(controller) {
    controller.enqueue(new TextEncoder().encode(`event: measurement\ndata: ${JSON.stringify(event)}\n\n`));
    controller.close();
  } });
  const client = createPresageCompanionClient({ capabilityToken: "a".repeat(32), fetchImpl: async () => new Response(stream, { status: 200 }) });
  const received = [];
  let connectedStatus;
  await client.subscribe("session-test", { onConnected: (status) => { connectedStatus = status; }, onEvent: (value) => received.push(value) });
  assert.equal(connectedStatus, 200);
  assert.equal(received.length, 1);
  assert.equal(received[0].sessionId, "session-test");
  assert.equal(received[0].type, "measurement");
});

test("malformed SSE JSON is ignored but event-handler errors are not swallowed", () => {
  let called = false;
  assert.equal(consumeSseBlocks("data: {bad json}\n\ndata: {}\n\n", () => { called = true; }), "");
  assert.equal(called, true);
  assert.throws(() => consumeSseBlocks("data: {}\n\n", () => { throw new Error("handler failure"); }), /handler failure/);
});

test("camera stop uses a small keepalive request for route or page teardown", async () => {
  let request;
  const client = createPresageCompanionClient({
    capabilityToken: "a".repeat(32),
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
    },
  });
  await client.stop("session-test", "b".repeat(64));
  assert.equal(request.url, "http://127.0.0.1:8765/v1/presage/stop");
  assert.equal(request.options.keepalive, true);
  assert.deepEqual(JSON.parse(request.options.body), { sessionId: "session-test", ownerToken: "b".repeat(64) });
  assert.equal(request.options.headers["X-Presage-Capability"], "a".repeat(32));
});

test("owner credential is ephemeral and stop cleanup is session-specific, idempotent, and retryable", async () => {
  const deterministicCrypto = { getRandomValues(bytes) { bytes.fill(7); return bytes; } };
  const ownerToken = createPresageOwnerToken(deterministicCrypto);
  assert.equal(ownerToken, "07".repeat(32));
  let attempts = 0;
  const failures = [];
  const stopper = createPresageOwnerStopper({ async stop(sessionId, token) {
    attempts += 1;
    assert.equal(sessionId, "session-specific");
    assert.equal(token, ownerToken);
    if (attempts === 1) throw new TypeError("sensitive detail is not propagated");
  } }, "session-specific", ownerToken, (failure) => failures.push(failure));
  const concurrent = await Promise.all([stopper.stop(), stopper.stop()]);
  assert.deepEqual(concurrent, [false, false]);
  assert.equal(attempts, 1);
  assert.deepEqual(failures, [{ operation: "stop", errorClass: "TypeError" }]);
  assert.equal(await stopper.stop(), true);
  assert.equal(await stopper.stop(), true);
  assert.equal(attempts, 2);
});

test("owner start and heartbeat use capability authentication and keep owner token out of URLs", async () => {
  const requests = [];
  const client = createPresageCompanionClient({ capabilityToken: "a".repeat(32), fetchImpl: async (url, options) => {
    requests.push({ url, options });
    return new Response(JSON.stringify({ accepted: true, status: "warming_up", renewed: true }), { status: 200, headers: { "Content-Type": "application/json" } });
  } });
  await client.start("session-test", "b".repeat(64));
  await client.heartbeat("session-test", "b".repeat(64));
  assert.deepEqual(requests.map(({ url }) => url), ["http://127.0.0.1:8765/v1/presage/start", "http://127.0.0.1:8765/v1/presage/heartbeat"]);
  assert.deepEqual(JSON.parse(requests[0].options.body), { sessionId: "session-test", consent: true, ownerToken: "b".repeat(64) });
  assert.deepEqual(JSON.parse(requests[1].options.body), { sessionId: "session-test", ownerToken: "b".repeat(64) });
});

test("pagehide and React unmount share one idempotent stop path", () => {
  const listeners = new Map();
  const target = {
    addEventListener(name, callback) { listeners.set(name, callback); },
    removeEventListener(name, callback) { if (listeners.get(name) === callback) listeners.delete(name); },
  };
  const teardowns = [];
  const remove = registerPresagePageLifecycle(target, (reason) => teardowns.push(reason));
  listeners.get("pagehide")();
  remove();
  assert.deepEqual(teardowns, ["pagehide"]);
  assert.equal(listeners.has("pagehide"), false);

  const removeOnUnmount = registerPresagePageLifecycle(target, (reason) => teardowns.push(reason));
  removeOnUnmount();
  assert.deepEqual(teardowns, ["pagehide", "unmount"]);
});

test("pagehide aborts the owner stream and submits one owner-specific stop", async () => {
  const listeners = new Map();
  const target = { addEventListener(name, callback) { listeners.set(name, callback); }, removeEventListener(name) { listeners.delete(name); } };
  const controller = new AbortController();
  const requests = [];
  const stopper = createPresageOwnerStopper({ async stop(sessionId, ownerToken) { requests.push({ sessionId, ownerToken }); } }, "ses_owner", "b".repeat(64));
  const remove = registerPresagePageLifecycle(target, () => { controller.abort(); void stopper.stop(); });
  listeners.get("pagehide")();
  remove();
  await stopper.stop();
  assert.equal(controller.signal.aborted, true);
  assert.deepEqual(requests, [{ sessionId: "ses_owner", ownerToken: "b".repeat(64) }]);
});

test("visible-tab return requests an immediate heartbeat; hidden transitions do not", () => {
  const listeners = new Map();
  const target = { visibilityState: "hidden", addEventListener(name, callback) { listeners.set(name, callback); }, removeEventListener(name) { listeners.delete(name); } };
  let count = 0;
  const remove = registerPresageVisibilityHeartbeat(target, () => { count += 1; });
  listeners.get("visibilitychange")();
  assert.equal(count, 0);
  target.visibilityState = "visible";
  listeners.get("visibilitychange")();
  assert.equal(count, 1);
  remove();
  assert.equal(listeners.has("visibilitychange"), false);
});

test("aborting an SSE subscription cancels its active reader", async () => {
  const controller = new AbortController();
  let activeSignal;
  let streamController;
  const stream = new ReadableStream({ start(value) { streamController = value; } });
  const client = createPresageCompanionClient({ capabilityToken: "a".repeat(32), fetchImpl: async (_url, options) => {
    activeSignal = options.signal;
    activeSignal.addEventListener("abort", () => streamController.error(new DOMException("Aborted", "AbortError")), { once: true });
    return new Response(stream, { status: 200 });
  } });
  const subscription = client.subscribe("session-test", { signal: controller.signal, onEvent() {} });
  await Promise.resolve();
  controller.abort();
  await assert.rejects(subscription, { name: "AbortError" });
  assert.equal(activeSignal.aborted, true);
});
