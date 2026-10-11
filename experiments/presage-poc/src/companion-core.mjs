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

  const subscribers = new Set([onEvent]);
  const emit = (event) => { const value = { schemaVersion: PRESAGE_TRANSPORT_SCHEMA_VERSION, emittedAt: clock(), ...event }; for (const subscriber of subscribers) subscriber(value); };
  const setStatus = (next, extra = {}) => { status = next; emit({ type: 'status', sessionId: activeSessionId, status: next, ...extra }); };
  const snapshot = () => ({ schemaVersion: PRESAGE_TRANSPORT_SCHEMA_VERSION, type: 'status', sessionId: activeSessionId, status });
  const clearSession = () => { sdk = undefined; activeSessionId = undefined; adapter = undefined; };
  const disposeSdk = async () => {
    try { await sdk?.stopAsync(); } catch { /* SDK may already be idle. */ }
    try { await sdk?.destroy(); } catch { /* Best-effort cleanup. */ }
  };

  async function stop(reason = 'stopped') {
    if (!activeSessionId) return snapshot();
    const stoppedSessionId = activeSessionId;
    closing = true;
    adapter?.revokeConsent();
    await disposeSdk();
    clearSession();
    closing = false;
    status = 'stopped';
    emit({ type: 'status', sessionId: stoppedSessionId, status, reason });
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
        if (ownsActiveSession() && validationCode !== 0) setStatus('quality_insufficient', { validationCode });
      });
      sessionSdk.on('metrics', (buffer, timestampUs) => {
        if (!ownsActiveSession() || !adapter?.consentGranted) return;
        const event = normalizeMetricEvent(decodeMetrics(buffer), timestampUs, clock());
        const result = adapter.summarize({ validationCode: 0, metricEvent: event });
        if (result.status !== 'available') { setStatus('quality_insufficient'); return; }
        setStatus('measuring');
        const metrics = result.summary.samples.map((sample) => ({ ...sample, measuredAt: result.summary.observedAt }));
        emit({ type: 'measurement', sessionId, observedAt: result.summary.observedAt, metrics,
          quality: { validationCode: 0, confidence: Math.min(...metrics.map((sample) => sample.confidence)), stable: true } });
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
      await disposeSdk();
      clearSession();
      return { accepted: false, status: failureStatus };
    }
  }

  return { start, stop, snapshot, subscribe(callback) { subscribers.add(callback); return () => subscribers.delete(callback); }, get activeSessionId() { return activeSessionId; } };
}
