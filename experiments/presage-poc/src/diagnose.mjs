import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CameraSelection, SmartSpectraSDK } from '@smartspectra/node-sdk';
import { createSmartSpectraOptions } from './sdk-options.mjs';
import { decodeMetrics } from '@smartspectra/node-sdk/messages';
import { discoverCamera, publicDiagnosticReport, runBoundedSdkSession, validateDiagnosticConfiguration } from './diagnostic-core.mjs';

const pocDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envFilePath = resolve(pocDirectory, '.env');
const inheritedKeyExists = Object.hasOwn(process.env, 'SMARTSPECTRA_API_KEY');
if (existsSync(envFilePath)) process.loadEnvFile(envFilePath);
const configuration = validateDiagnosticConfiguration({
  envFileExists: existsSync(envFilePath),
  apiKey: process.env.SMARTSPECTRA_API_KEY,
  inheritedKeyExists,
});
const report = {
  configuration,
  sdk: { status: 'PASS', installedVersion: SmartSpectraSDK.version },
  // SmartSpectra does not document a public authentication hostname for direct probing.
  // The SDK is the sole supported path for authentication and pairing diagnostics.
  network: { status: 'UNKNOWN', reason: 'noDocumentedSdkAuthenticationEndpointForDirectProbe' },
  camera: null,
  session: null,
};
if (configuration.status === 'PASS') {
  report.camera = discoverCamera(SmartSpectraSDK);
  if (report.camera.status === 'PASS') {
    if (process.env.SMARTSPECTRA_DIAGNOSTIC_CONSENT !== 'yes') {
      report.session = { status: 'BLOCKED', reason: 'explicitConsentRequiredBeforeCameraCapture' };
    } else {
      const configured = Number.parseInt(process.env.SMARTSPECTRA_SESSION_TIMEOUT_MS ?? '30000', 10);
      const timeoutMs = Number.isFinite(configured) ? Math.max(5000, Math.min(configured, 90000)) : 30000;
      const controller = new AbortController();
      process.once('SIGINT', () => controller.abort());
      const sdk = new SmartSpectraSDK(createSmartSpectraOptions(process.env.SMARTSPECTRA_API_KEY));
      report.session = await runBoundedSdkSession({ sdk, cameraSelection: CameraSelection.default, timeoutMs, decodeMetrics, signal: controller.signal });
    }
  } else report.session = { status: 'BLOCKED', reason: 'cameraCheckFailed' };
} else {
  report.camera = { status: 'BLOCKED', reason: 'configurationCheckFailed' };
  report.session = { status: 'BLOCKED', reason: 'configurationCheckFailed' };
}
console.log(publicDiagnosticReport(report));
