import { CameraSelection, SmartSpectraSDK } from '@smartspectra/node-sdk';
import { decodeMetrics } from '@smartspectra/node-sdk/messages';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPresageCompanion } from './companion-core.mjs';
import { createCompanionServer } from './companion-server-core.mjs';
import { inspectCredentialShape } from './credential-shape.mjs';
import { createSmartSpectraOptions } from './sdk-options.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = resolve(root, '.env');
if (existsSync(envPath)) process.loadEnvFile(envPath);
const credential = inspectCredentialShape(process.env.SMARTSPECTRA_API_KEY);
const token = process.env.PRESAGE_COMPANION_TOKEN;
if (!credential.usable || typeof token !== 'string' || token.length < 32) {
  console.error('Companion requires a usable local SmartSpectra key and a 32-character PRESAGE_COMPANION_TOKEN.');
  process.exitCode = 2;
} else {
  const companion = createPresageCompanion({
    createSdk: () => new SmartSpectraSDK(createSmartSpectraOptions(process.env.SMARTSPECTRA_API_KEY)),
    availableCameras: () => SmartSpectraSDK.availableCameras(), decodeMetrics, cameraSelection: CameraSelection.default,
  });
  const origins = new Set((process.env.PRESAGE_COMPANION_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173').split(',').map((value) => value.trim()).filter(Boolean));
  const transport = createCompanionServer({ companion, capabilityToken: token, allowedOrigins: origins, onRequest: (event) => console.log(JSON.stringify({ event: 'companionRequest', ...event })) });
  const port = Number.parseInt(process.env.PRESAGE_COMPANION_PORT ?? '8765', 10);
  transport.server.listen(port, '127.0.0.1', () => console.log(JSON.stringify({ event: 'companionListening', host: '127.0.0.1', port })));
  const shutdown = () => void transport.close().finally(() => process.exit(0));
  process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
}
