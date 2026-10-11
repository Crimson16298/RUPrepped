import { normalizeMetricEvent } from './metric-extraction.mjs';
import { createSessionMeasurementAdapter } from './session-measurement-adapter.mjs';
import { classifySmartSpectraError } from './sdk-options.mjs';

export const PRESAGE_TRANSPORT_SCHEMA_VERSION = '1.0.0';

const validSessionId = (value) => typeof value === 'string' && value.trim().length > 0;
const now = () => new Date().toISOString();

/** A local, single-session bridge. It owns no persistence and emits no frames. */
export function createPresageCompanion({ createSdk, availableCameras, decodeMetrics, cameraSelection, onEvent = () => {}, clock = now }) {
  let sdk;
  let adapter;
  let activeSessionId;
  let status = 'awaiting_consent';
  let closing = false;
  let lastValidationCode;
  let metricCallbackCount = 0;
  let cleanupStatus;

  const subscribers = new Set([onEvent]);
  const emit = (event) => { const value = { schemaVersion: PRESAGE_TRANSPORT_SCHEMA_VERSION, emittedAt: clock(), ...event }; for (const subscriber of subscribers) subscriber(value); };
  const setStatus = (next, extra = {}) => { status = next; emit({ type: 'status', sessionId: activeSessionId, status: next, ...extra }); };
  const snapshot = () => ({ schemaVersion: PRESAGE_TRANSPORT_SCHEMA_VERSION, type: 'status', sessionId: activeSessionId, status, ...(lastValidationCode !== undefined ? { validationCode: lastValidationCode } : {}), ...(cleanupStatus ? { cleanup: cleanupStatus } : {}) });
  const clearSession = () => { sdk = undefined; activeSessionId = undefined; adapter = undefined; lastValidationCode = undefined; metricCallbackCount = 0; };
  const disposeSdk = async (sessionId) => {
    const failures = [];
    for (const operation of ['stopAsync', 'destroy']) {
      try { await sdk?.[operation](); } catch (error) {
        const name = error instanceof Error ? error.name : 'unknown';
        const errorClass = ['Error', 'TypeError', 'RangeError'].includes(name) ? name : 'unknown';
        failures.push({ operation, errorClass });
        emit({ type: 'diagnostic', sessionId, kind: 'sdk_cleanup', operation, errorClass });
      }
    }
    return failures;
  };

  async function stop(reason = 'stopped') {
    if (!activeSessionId) return snapshot();
    const stoppedSessionId = activeSessionId;
    closing = true;
    adapter?.revokeConsent();
    const cleanupFailures = await disposeSdk(stoppedSessionId);
    clearSession();
    closing = false;
    status = 'stopped';
    cleanupStatus = cleanupFailures.length ? 'failed' : 'succeeded';
    emit({ type: 'status', sessionId: stoppedSessionId, status, reason, ...(cleanupFailures.length ? { cleanup: 'failed' } : { cleanup: 'succeeded' }) });
    return snapshot();
  }

  async function start({ sessionId, consent }) {
    if (!validSessionId(sessionId) || consent !== true) {
      return { accepted: false, status: 'awaiting_consent' };
    }
    if (activeSessionId) {
      return activeSessionId === sessionId
        ? { accepted: true, status, duplicate: true }
        : { accepted: false, status: 'session_active_elsewhere' };
    }
    activeSessionId = sessionId;
    cleanupStatus = undefined;
    adapter = createSessionMeasurementAdapter(sessionId);
    adapter.grantConsent();
    setStatus('starting');
    let cameras;
    try { cameras = availableCameras(); } catch {
      setStatus('unavailable', { reason: 'camera_discovery_failed' });
      clearSession();
      return { accepted: false, status: 'unavailable' };
    }
    if (!cameras.length) {
      setStatus('unavailable', { reason: 'camera_unavailable' });
      clearSession();
      return { accepted: false, status: 'unavailable' };
    }
    try {
      sdk = createSdk();
      const sessionSdk = sdk;
      const ownsActiveSession = () => !closing && sdk === sessionSdk && activeSessionId === sessionId;
      sessionSdk.on('processingStatus', (value) => {
        if (ownsActiveSession() && value === 3) setStatus('warming_up');
      });
      sessionSdk.on('validationStatus', (validationCode) => {
        if (!ownsActiveSession() || !Number.isInteger(validationCode) || lastValidationCode === validationCode) return;
        lastValidationCode = validationCode;
        setStatus(validationCode === 0 ? 'warming_up' : 'quality_insufficient', { validationCode });
      });
      sessionSdk.on('metrics', (buffer, timestampUs) => {
        if (!ownsActiveSession() || !adapter?.consentGranted) return;
        const event = normalizeMetricEvent(decodeMetrics(buffer), timestampUs, clock());
        const result = adapter.summarize({ validationCode: lastValidationCode, metricEvent: event });
        metricCallbackCount += 1;
        emit({
          type: 'diagnostic',
          sessionId,
          kind: 'sdk_metrics_callback',
          callbackCount: metricCallbackCount,
          validationCode: lastValidationCode ?? null,
          supportedMetricCount: event?.samples.length ?? 0,
          outcome: result.status,
        });
        if (result.status !== 'available') { setStatus('quality_insufficient'); return; }
        setStatus('measuring');
        const metrics = result.summary.samples.map((sample) => ({ ...sample, measuredAt: result.summary.observedAt }));
        emit({ type: 'measurement', sessionId, observedAt: result.summary.observedAt, metrics,
          quality: { validationCode: lastValidationCode, confidence: Math.min(...metrics.map((sample) => sample.confidence)), stable: true } });
      });
      sessionSdk.on('error', (code, _message, retryable) => {
        if (!ownsActiveSession()) return;
        const classification = classifySmartSpectraError(code);
        setStatus(classification === 'inputUnavailable' ? 'unavailable' : 'error', { code, classification, retryable: Boolean(retryable) });
        if (!retryable) void stop('sdk_error');
      });
      sessionSdk.useCamera(cameraSelection);
      sessionSdk.start();
      return { accepted: true, status };
    } catch (error) {
      const failureStatus = classifySmartSpectraError(error?.code) === 'inputUnavailable' ? 'unavailable' : 'error';
      setStatus(failureStatus);
      adapter?.revokeConsent();
      await disposeSdk(sessionId);
      clearSession();
      return { accepted: false, status: failureStatus };
    }
  }

  return { start, stop, snapshot, subscribe(callback) { subscribers.add(callback); return () => subscribers.delete(callback); }, get activeSessionId() { return activeSessionId; } };
}
