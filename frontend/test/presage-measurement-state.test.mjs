import assert from "node:assert/strict";
import test from "node:test";
import { applyPresageEvent, createPresageLifecycleQueue, emptyPresageSnapshot, prunePresageSnapshot, snapshotForSession } from "../src/hooks/presageMeasurementState.mjs";

const sessionId = "session-test-a";
const now = Date.parse("2026-10-11T04:00:00.000Z");
const validMeasurement = (overrides = {}) => ({
  schemaVersion: "1.0.0",
  type: "measurement",
  sessionId,
  emittedAt: "2026-10-11T04:00:00.000Z",
  observedAt: "2026-10-11T04:00:00.000Z",
  metrics: [{ metric: "pulseRate", value: 72, unit: "bpm", confidence: 90, stable: true, measuredAt: "2026-10-11T04:00:00.000Z" }],
  quality: { validationCode: 0, confidence: 90, stable: true },
  ...overrides,
});

test("a genuine, validated measurement becomes available to the sidebar", () => {
  const next = applyPresageEvent(emptyPresageSnapshot("warming-up"), validMeasurement(), sessionId, now);
  assert.equal(next.availability, "available");
  assert.equal(next.measurements[0].metric, "pulseRate");
  assert.equal(next.source, "presage-smartspectra");
});

test("transient quality warnings remain separate and preserve a fresh valid reading", () => {
  const current = applyPresageEvent(emptyPresageSnapshot("warming-up"), validMeasurement(), sessionId, now);
  const warned = applyPresageEvent(current, {
    schemaVersion: "1.0.0", type: "status", sessionId, status: "quality_insufficient", validationCode: 7,
  }, sessionId, now + 1_000);
  assert.equal(warned.availability, "available");
  assert.equal(warned.measurements.length, 1);
  assert.equal(warned.qualityWarning.validationCode, 7);
});

test("fresh measurements expire even if no further SSE event arrives", () => {
  const current = applyPresageEvent(emptyPresageSnapshot("warming-up"), validMeasurement(), sessionId, now);
  const stale = prunePresageSnapshot(current, now + 30_001);
  assert.equal(stale.availability, "unavailable");
  assert.equal(stale.measurements.length, 0);
});

test("low-confidence, unstable, unknown, future, and malformed samples are rejected", () => {
  const current = emptyPresageSnapshot("warming-up");
  for (const metrics of [
    [{ metric: "pulseRate", value: 70, confidence: 69, stable: true, measuredAt: "2026-10-11T04:00:00.000Z" }],
    [{ metric: "pulseRate", value: 70, confidence: 90, stable: false, measuredAt: "2026-10-11T04:00:00.000Z" }],
    [{ metric: "unrecognizedMetric", value: 70, confidence: 90, stable: true, measuredAt: "2026-10-11T04:00:00.000Z" }],
    [{ metric: "pulseRate", value: 70, confidence: 90, stable: true, measuredAt: "2026-10-11T04:01:00.000Z" }],
  ]) {
    const rejected = applyPresageEvent(current, validMeasurement({ metrics }), sessionId, now);
    assert.equal(rejected.availability, "warming-up");
    assert.equal(rejected.measurements.length, 0);
    assert.equal(rejected.qualityWarning.status, "measurement_rejected");
  }
  assert.equal(applyPresageEvent(current, { ...validMeasurement(), quality: undefined }, sessionId, now).availability, "warming-up");
});

test("missing or incorrect session IDs cannot affect current session state", () => {
  const current = emptyPresageSnapshot("warming-up");
  assert.equal(applyPresageEvent(current, validMeasurement({ sessionId: "session-test-old" }), sessionId, now), current);
  assert.equal(applyPresageEvent(current, { ...validMeasurement(), sessionId: undefined }, sessionId, now), current);
});

test("a new session and a lost/ended session never inherit previous readings", () => {
  const current = applyPresageEvent(emptyPresageSnapshot("warming-up"), validMeasurement(), sessionId, now);
  assert.equal(snapshotForSession({ sessionId, snapshot: current }, "session-test-b", true).measurements.length, 0);
  assert.equal(snapshotForSession({ sessionId, snapshot: current }, null, true).availability, "unavailable");
  const ended = applyPresageEvent(current, { schemaVersion: "1.0.0", type: "status", sessionId, status: "stopped" }, sessionId, now);
  assert.equal(ended.availability, "unavailable");
  assert.equal(ended.measurements.length, 0);
  assert.equal(snapshotForSession({ sessionId, snapshot: current }, sessionId, false).measurements.length, 0);
});

test("StrictMode-style setup/cleanup serialization stops the first lease before a second starts", async () => {
  const events = [];
  const queue = createPresageLifecycleQueue();
  let releaseFirstStart;
  const firstStartGate = new Promise((resolve) => { releaseFirstStart = resolve; });
  const firstStart = queue.run(async () => { events.push("strict-first:start"); await firstStartGate; events.push("strict-first:subscribe"); });
  const firstCleanup = queue.run(async () => { await firstStart; events.push("strict-first:stop"); });
  const secondStart = queue.run(async () => { events.push("strict-second:start"); });
  releaseFirstStart();
  await Promise.all([firstStart, firstCleanup, secondStart]);
  assert.ok(events.indexOf("strict-first:stop") < events.indexOf("strict-second:start"));
  assert.equal(events.filter((event) => event.endsWith(":start")).length, 2);
});
