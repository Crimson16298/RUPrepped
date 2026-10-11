import { inspectCredentialShape } from './credential-shape.mjs';
import { extractMetricSamples } from './metric-extraction.mjs';
import { classifySmartSpectraError, createSmartSpectraOptions } from './sdk-options.mjs';
import { describeValidationCode, summarizeValidationStatus } from './validation-status.mjs';

export function validateDiagnosticConfiguration({ envFileExists, apiKey, inheritedKeyExists = false }) {
  const credential = inspectCredentialShape(apiKey);
  if (!envFileExists && !inheritedKeyExists) return { status: 'FAIL', reason: 'localEnvMissing', credential };
  if (!credential.exists) return { status: 'FAIL', reason: 'apiKeyMissing', credential };
  if (!credential.usable) return { status: 'FAIL', reason: 'apiKeyMalformed', credential };
  const options = createSmartSpectraOptions(apiKey);
  return {
    status: 'PASS',
    reason: 'apiKeyConfigured',
    credential,
    sdkReceivesApiKeyViaDocumentedOption: Object.hasOwn(options, 'apiKey') && options.apiKey === apiKey,
  };
}

export function discoverCamera(sdkClass) {
  try {
    const cameras = sdkClass.availableCameras();
    return cameras.length
      ? { status: 'PASS', reason: 'cameraDiscovered', cameraCount: cameras.length }
      : { status: 'FAIL', reason: 'cameraUnavailable', cameraCount: 0 };
  } catch (error) {
    return { status: 'FAIL', reason: 'cameraDiscoveryFailed', errorCode: error?.code ?? null };
  }
}

export async function runBoundedSdkSession({ sdk, cameraSelection, timeoutMs, decodeMetrics, signal }) {
  const events = [];
  const metricTypes = new Set();
  const validationByCode = new Map();
  let settled = false;
  let resolveDone;
  const done = new Promise((resolve) => { resolveDone = resolve; });
  const settle = (outcome) => { if (!settled) { settled = true; resolveDone(outcome); } };
  const record = (event) => events.push(event);
  sdk.on('processingStatus', (status) => record({ event: 'processingStatus', status }));
  sdk.on('validationStatus', (code, _timestampUs, hint) => {
    const aggregate = validationByCode.get(code) ?? { count: 0, hintPresent: false };
    aggregate.count += 1;
    aggregate.hintPresent ||= Boolean(hint);
    validationByCode.set(code, aggregate);
  });
  sdk.on('metrics', (buffer) => {
    const samples = extractMetricSamples(decodeMetrics(buffer));
    for (const sample of samples) metricTypes.add(sample.metric);
    if (samples.length) record({ event: 'metrics', sampleCount: samples.length });
  });
  sdk.on('error', (code, _message, retryable) => {
    const classification = classifySmartSpectraError(code);
    record({ event: 'sdkError', code, classification, retryable: Boolean(retryable) });
    if (!retryable) settle({ kind: 'sdkError', code, classification });
  });
  const abort = () => settle({ kind: 'cancelled' });
  signal?.addEventListener('abort', abort, { once: true });
  let timer;
  try {
    sdk.useCamera(cameraSelection);
    sdk.start();
    timer = setTimeout(() => settle({ kind: 'timeout' }), timeoutMs);
    const outcome = await done;
    if (outcome.kind === 'sdkError') {
      const reason = outcome.classification === 'authenticationFailed' ? 'authenticationFailure'
        : outcome.classification === 'inputUnavailable' ? 'cameraUnavailableOrPermissionDenied'
          : outcome.classification;
      return { status: 'FAIL', reason, outcome, events, validationSummary: summarizeValidationStatus(validationByCode), metricTypes: [...metricTypes] };
    }
    if (metricTypes.size) return { status: 'PASS', reason: 'realMeasurementsReceived', outcome, events, validationSummary: summarizeValidationStatus(validationByCode), metricTypes: [...metricTypes] };
    return { status: 'BLOCKED', reason: outcome.kind === 'cancelled' ? 'sessionCancelled' : 'noValidMeasurements', outcome, events, validationSummary: summarizeValidationStatus(validationByCode), metricTypes: [] };
  } catch (error) {
    const classification = classifySmartSpectraError(error?.code);
    return {
      status: 'FAIL',
      reason: classification === 'inputUnavailable' ? 'cameraUnavailableOrPermissionDenied' : 'cameraInitializationFailed',
      errorCode: error?.code ?? null,
      events,
      validationSummary: summarizeValidationStatus(validationByCode),
      metricTypes: [],
    };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    try { await sdk.stopAsync(); } catch { record({ event: 'stopFailed' }); }
    try { await sdk.destroy(); } catch { record({ event: 'destroyFailed' }); }
  }
}

export function publicDiagnosticReport(report) {
  // Deliberately copy only whitelisted, non-secret diagnostic evidence.
  const credential = report.configuration?.credential ?? {};
  const session = report.session;
  return JSON.stringify({
    configuration: {
      status: report.configuration?.status ?? 'UNKNOWN',
      reason: report.configuration?.reason ?? 'unknown',
      credential: {
        exists: Boolean(credential.exists),
        nonempty: Boolean(credential.nonempty),
        hasSurroundingWhitespace: Boolean(credential.hasSurroundingWhitespace),
        hasSurroundingQuotes: Boolean(credential.hasSurroundingQuotes),
      },
      sdkReceivesApiKeyViaDocumentedOption: Boolean(report.configuration?.sdkReceivesApiKeyViaDocumentedOption),
    },
    sdk: {
      status: report.sdk?.status ?? 'UNKNOWN',
      installedVersion: typeof report.sdk?.installedVersion === 'string' ? report.sdk.installedVersion : undefined,
    },
    camera: {
      status: report.camera?.status ?? 'UNKNOWN',
      reason: report.camera?.reason ?? 'unknown',
      cameraCount: Number.isInteger(report.camera?.cameraCount) ? report.camera.cameraCount : undefined,
      errorCode: typeof report.camera?.errorCode === 'number' ? report.camera.errorCode : undefined,
    },
    network: {
      status: report.network?.status ?? 'UNKNOWN',
      reason: report.network?.reason ?? 'unknown',
    },
    session: session ? {
      status: session.status ?? 'UNKNOWN',
      reason: session.reason ?? 'unknown',
      errorCode: typeof session.errorCode === 'number' ? session.errorCode : undefined,
      outcome: session.outcome ? {
        kind: session.outcome.kind,
        code: typeof session.outcome.code === 'number' ? session.outcome.code : undefined,
        classification: session.outcome.classification,
      } : undefined,
      metricTypes: Array.isArray(session.metricTypes) ? session.metricTypes.filter((metric) => typeof metric === 'string') : [],
      validationSummary: Array.isArray(session.validationSummary) ? session.validationSummary.map((status) => {
        const code = typeof status?.code === 'number' ? status.code : undefined;
        return {
          code,
          ...describeValidationCode(code),
          count: Number.isInteger(status?.count) ? status.count : undefined,
          hintPresent: typeof status?.hintPresent === 'boolean' ? status.hintPresent : undefined,
        };
      }) : [],
      events: Array.isArray(session.events) ? session.events.map((event) => ({
        event: event?.event,
        status: typeof event?.status === 'number' ? event.status : undefined,
        code: typeof event?.code === 'number' ? event.code : undefined,
        classification: typeof event?.classification === 'string' ? event.classification : undefined,
        retryable: typeof event?.retryable === 'boolean' ? event.retryable : undefined,
        hintPresent: typeof event?.hintPresent === 'boolean' ? event.hintPresent : undefined,
        sampleCount: Number.isInteger(event?.sampleCount) ? event.sampleCount : undefined,
      })) : [],
    } : undefined,
  });
}
