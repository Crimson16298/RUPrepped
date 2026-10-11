import {
  CameraSelection,
  SmartSpectraSDK,
} from '@smartspectra/node-sdk';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeMetrics } from '@smartspectra/node-sdk/messages';
import { normalizeMetricEvent } from './metric-extraction.mjs';
import { inspectCredentialShape } from './credential-shape.mjs';
import { classifySmartSpectraError, createSmartSpectraOptions } from './sdk-options.mjs';

const pocDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envFilePath = resolve(pocDirectory, '.env');
if (existsSync(envFilePath)) process.loadEnvFile(envFilePath);

const apiKey = process.env.SMARTSPECTRA_API_KEY;
const credential = inspectCredentialShape(apiKey);
const configuredTimeoutMs = Number.parseInt(process.env.SMARTSPECTRA_SESSION_TIMEOUT_MS ?? '90000', 10);
const sessionTimeoutMs = Number.isFinite(configuredTimeoutMs) && configuredTimeoutMs > 0
  ? configuredTimeoutMs
  : 90000;
if (!credential.usable) {
  console.error('SMARTSPECTRA_API_KEY must be nonempty and free of surrounding quotes or whitespace. Run npm run diagnose:credentials for non-secret details.');
  process.exitCode = 2;
} else if (process.env.SMARTSPECTRA_MEASUREMENT_CONSENT !== 'yes') {
  console.error('SMARTSPECTRA_MEASUREMENT_CONSENT=yes is required before camera capture.');
  process.exitCode = 2;
} else {
  await run(apiKey);
}

async function run(key) {
  let cameras;
  try {
    cameras = SmartSpectraSDK.availableCameras();
  } catch (error) {
    console.error(JSON.stringify({ event: 'cameraDiscoveryError', code: error.code ?? null }));
    process.exitCode = 1;
    return;
  }

  if (cameras.length === 0) {
    console.error(JSON.stringify({ event: 'cameraUnavailable', message: 'No camera was discovered by SmartSpectra.' }));
    process.exitCode = 1;
    return;
  }

  // Do not expose opaque camera IDs in routine output; name/facing are enough for verification.
  console.log(JSON.stringify({
    event: 'cameraDiscovered',
    cameras: cameras.map(({ name, facing, lensType }) => ({ name, facing, lensType })),
  }));

  const sdk = new SmartSpectraSDK(createSmartSpectraOptions(key));
  let closing = false;
  let timeout;

  const shutdown = async (signal) => {
    if (closing) return;
    closing = true;
    clearTimeout(timeout);
    console.log(JSON.stringify({ event: 'shutdown', signal, timestamp: new Date().toISOString() }));
    try {
      await sdk.stopAsync();
    } catch (error) {
      // The SDK can already be idle after an initialization or camera error.
      console.error(JSON.stringify({ event: 'stopError', code: error.code ?? null }));
    }
    try {
      await sdk.destroy();
    } catch (error) {
      console.error(JSON.stringify({ event: 'destroyError', code: error.code ?? null }));
    }
  };

  sdk.on('processingStatus', (status) => {
    console.log(JSON.stringify({ event: 'processingStatus', status, timestamp: new Date().toISOString() }));
  });
  sdk.on('validationStatus', (code, timestampUs, hint) => {
    console.log(JSON.stringify({ event: 'validationStatus', code, timestampUs, hint }));
  });
  sdk.on('metrics', (buffer, timestampUs) => {
    const metrics = decodeMetrics(buffer);
    const metricEvent = normalizeMetricEvent(metrics, timestampUs);
    if (metricEvent) console.log(JSON.stringify({ event: 'metric', ...metricEvent }));
  });
  sdk.on('error', (code, _message, retryable) => {
    console.error(JSON.stringify({ event: 'sdkError', code, classification: classifySmartSpectraError(code), retryable }));
    if (!retryable) void shutdown('nonRetryableSdkError');
  });

  process.once('SIGINT', () => void shutdown('SIGINT').finally(() => process.exit(0)));
  process.once('SIGTERM', () => void shutdown('SIGTERM').finally(() => process.exit(0)));

  try {
    sdk.useCamera(CameraSelection.default);
    sdk.start();
    console.log(JSON.stringify({
      event: 'started',
      sessionTimeoutMs,
      message: 'Measuring from the default camera. Press Ctrl+C to stop early.',
    }));
    timeout = setTimeout(() => {
      console.log(JSON.stringify({ event: 'sessionTimeout', sessionTimeoutMs }));
      void shutdown('sessionTimeout').finally(() => process.exit(0));
    }, sessionTimeoutMs);
  } catch (error) {
    console.error(JSON.stringify({ event: 'startError', code: error.code ?? null, retryable: Boolean(error.retryable) }));
    await shutdown('startError');
    process.exitCode = 1;
  }
}
