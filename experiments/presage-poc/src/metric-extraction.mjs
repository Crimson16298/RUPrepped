/**
 * Maps only documented SmartSpectra protobuf fields to a stable JSONL shape.
 * No readings are synthesized: a missing field stays absent.
 */
function latest(items) {
  return Array.isArray(items) && items.length ? items.at(-1) : undefined;
}

function timestampUs(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? value : String(value);
  if (value && typeof value.toString === 'function') return value.toString();
  return undefined;
}

function sample(name, unit, item) {
  if (!item || typeof item.value !== 'number') return undefined;
  return {
    metric: name,
    value: item.value,
    unit,
    confidence: typeof item.confidence === 'number' ? item.confidence : undefined,
    stable: typeof item.stable === 'boolean' ? item.stable : undefined,
    timestampUs: timestampUs(item.timestamp),
  };
}

export function extractMetricSamples(metrics) {
  const samples = [
    sample('breathingRate', 'breaths/min', latest(metrics?.breathing?.rate)),
    sample('pulseRate', 'bpm', latest(metrics?.cardio?.pulseRate)),
  ].filter(Boolean);

  const hrv = latest(metrics?.cardio?.hrv);
  if (hrv && typeof hrv.rmssd === 'number') {
    samples.push({
      metric: 'hrvRmssd',
      value: hrv.rmssd,
      // The installed declaration does not state the RMSSD unit, so omit it.
      confidence: typeof hrv.confidence === 'number' ? hrv.confidence : undefined,
      stable: typeof hrv.stable === 'boolean' ? hrv.stable : undefined,
      timestampUs: timestampUs(hrv.timestamp),
    });
  }
  return samples;
}

/**
 * Converts an actual decoded SDK metrics callback into the stable Person 3
 * event shape. Returns undefined when the SDK supplied no supported reading.
 */
export function normalizeMetricEvent(metrics, sdkEventTimestampUs, receivedAt = new Date().toISOString()) {
  const samples = extractMetricSamples(metrics);
  if (!samples.length) return undefined;
  return {
    source: 'presage-smartspectra',
    sdkEventTimestampUs: timestampUs(sdkEventTimestampUs),
    receivedAt,
    samples,
  };
}
