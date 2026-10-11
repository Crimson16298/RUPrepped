/**
 * Consent-gated bridge from a real decoded SmartSpectra event to a minimal,
 * session-associated summary. It never opens a camera or persists data.
 */
export const SESSION_MEASUREMENT_SCHEMA_VERSION = '1.0.0';

const MINIMUM_CONFIDENCE = 70;

function validSessionId(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function validSample(sample) {
  return sample
    && typeof sample.metric === 'string'
    && typeof sample.value === 'number'
    && Number.isFinite(sample.value)
    && typeof sample.confidence === 'number'
    && Number.isFinite(sample.confidence)
    && sample.confidence >= MINIMUM_CONFIDENCE
    && sample.stable === true;
}

/** State belongs to the local camera host; FastAPI never receives frames. */
export function createSessionMeasurementAdapter(sessionId) {
  if (!validSessionId(sessionId)) throw new TypeError('A nonempty interview session identifier is required.');
  let consent = false;

  return {
    grantConsent() { consent = true; },
    revokeConsent() { consent = false; },
    get consentGranted() { return consent; },
    summarize({ validationCode, metricEvent } = {}) {
      if (!consent) return { status: 'consent_not_granted' };
      if (validationCode !== 0) return { status: 'measurement_not_valid' };
      if (!metricEvent || metricEvent.source !== 'presage-smartspectra' || !Array.isArray(metricEvent.samples)) {
        return { status: 'camera_or_measurement_unavailable' };
      }
      const samples = metricEvent.samples.filter(validSample).map((sample) => ({
        metric: sample.metric,
        value: sample.value,
        ...(sample.unit ? { unit: sample.unit } : {}),
        confidence: sample.confidence,
        stable: true,
      }));
      if (!samples.length) return { status: 'measurement_quality_insufficient' };
      return {
        status: 'available',
        summary: {
          schemaVersion: SESSION_MEASUREMENT_SCHEMA_VERSION,
          sessionId,
          observedAt: metricEvent.receivedAt,
          samples,
        },
      };
    },
  };
}
