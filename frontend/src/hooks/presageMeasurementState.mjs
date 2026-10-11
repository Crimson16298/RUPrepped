const VALID_METRICS = new Set(["breathingRate", "pulseRate", "hrvRmssd"]);
const FRESHNESS_MS = 30_000;

/** Serializes StrictMode remounts and consent/session transitions around one camera lease. */
export function createPresageLifecycleQueue() {
  let tail = Promise.resolve();
  return {
    run(operation) {
      const task = tail.then(operation, operation);
      tail = task.then(() => undefined, () => undefined);
      return task;
    },
    wait() { return tail; },
  };
}

export function emptyPresageSnapshot(availability = "unavailable") {
  return { availability, measurements: [], connectionState: "disconnected" };
}

function isFresh(measurement, now, maxAgeMs) {
  const timestamp = Date.parse(measurement.measuredAt);
  return Number.isFinite(measurement.value)
    && Number.isFinite(timestamp)
    && timestamp <= now
    && now - timestamp <= maxAgeMs;
}

export function prunePresageSnapshot(snapshot, now = Date.now(), maxAgeMs = FRESHNESS_MS) {
  const measurements = (snapshot.measurements ?? []).filter((measurement) => isFresh(measurement, now, maxAgeMs));
  if (measurements.length === (snapshot.measurements ?? []).length) return snapshot;
  return {
    ...snapshot,
    availability: measurements.length ? "available" : "unavailable",
    measurements,
    source: measurements.length ? snapshot.source : undefined,
  };
}

function validatedSamples(event, now) {
  if (event.schemaVersion !== "1.0.0"
    || event.type !== "measurement"
    || event.quality?.validationCode !== 0
    || event.quality?.stable !== true
    || !Number.isFinite(event.quality?.confidence)
    || event.quality.confidence < 70
    || !Array.isArray(event.metrics)) return [];

  return event.metrics.filter((metric) => metric
    && VALID_METRICS.has(metric.metric)
    && Number.isFinite(metric.value)
    && Number.isFinite(metric.confidence)
    && metric.confidence >= 70
    && metric.stable === true
    && isFresh(metric, now, FRESHNESS_MS));
}

/** Apply an untrusted companion event without allowing stale or cross-session data into the UI. */
export function applyPresageEvent(previous, event, sessionId, now = Date.now()) {
  if (!event || event.sessionId !== sessionId || event.schemaVersion !== "1.0.0") return previous;
  const current = prunePresageSnapshot(previous, now);

  if (event.type === "diagnostic") return current;
  if (event.type === "measurement") {
    const measurements = validatedSamples(event, now).map(({ metric, value, confidence, stable, measuredAt }) => ({
      metric, value, confidence, stable, measuredAt,
    }));
    if (!measurements.length) {
      return {
        ...current,
        qualityWarning: { status: "measurement_rejected" },
      };
    }
    return {
      ...current,
      availability: "available",
      measurements,
      source: "presage-smartspectra",
      validationCode: 0,
      qualityWarning: undefined,
      connectionState: "connected",
    };
  }
  if (event.type !== "status") return current;

  if (event.status === "stopped") return emptyPresageSnapshot("unavailable");

  const validationCode = Number.isInteger(event.validationCode) ? event.validationCode : undefined;
  const qualityWarning = event.status === "quality_insufficient" || (validationCode !== undefined && validationCode !== 0)
    ? { status: event.status, ...(validationCode !== undefined ? { validationCode } : {}) }
    : validationCode === 0 ? undefined : current.qualityWarning;

  if (current.measurements?.length) {
    return { ...current, availability: "available", validationCode, qualityWarning };
  }

  return {
    ...current,
    availability: event.status === "starting" || event.status === "warming_up" ? "warming-up" : "unavailable",
    validationCode,
    qualityWarning,
  };
}

export function snapshotForSession(stored, sessionId, consentGranted) {
  if (!consentGranted) return emptyPresageSnapshot("not-requested");
  if (!sessionId) return emptyPresageSnapshot("unavailable");
  if (stored?.sessionId !== sessionId) return emptyPresageSnapshot("warming-up");
  return prunePresageSnapshot(stored.snapshot);
}
