import { breathingMetrics, cardioMetrics, SmartSpectraLogLevel } from '@smartspectra/node-sdk';

/** Builds the documented SmartSpectra constructor options used by the POC. */
export function createSmartSpectraOptions(apiKey) {
  return {
    apiKey,
    requestedMetrics: [...breathingMetrics, ...cardioMetrics],
    // Keep SDK errors observable through its public error event while avoiding
    // warning-level native logging in this command-line diagnostic.
    logLevel: SmartSpectraLogLevel.kError,
    // This POC records its own local JSONL only; do not start SDK aggregate telemetry.
    enableTelemetry: false,
  };
}

/** Maps only installed SDK error constants to non-secret diagnostic labels. */
export function classifySmartSpectraError(code) {
  return new Map([
    [0, 'ok'],
    [1, 'invalidState'],
    [2, 'authenticationFailed'],
    [3, 'configurationFailed'],
    [4, 'creditExhausted'],
    [5, 'networkError'],
    [6, 'serverError'],
    [7, 'inputUnavailable'],
    [8, 'processingFailed'],
    [9, 'frameConversionFailed'],
    [10, 'nonMonotonicTimestamp'],
    [11, 'timestampGap'],
  ]).get(code) ?? 'unknownSdkError';
}
