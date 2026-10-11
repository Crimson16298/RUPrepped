import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { inspectCredentialShape } from './credential-shape.mjs';
import { createSmartSpectraOptions } from './sdk-options.mjs';

const pocDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envFilePath = resolve(pocDirectory, '.env');
const inheritedKeyExists = Object.hasOwn(process.env, 'SMARTSPECTRA_API_KEY');
const localEnv = existsSync(envFilePath) ? parseEnv(readFileSync(envFilePath, 'utf8')) : {};
const localCredential = inspectCredentialShape(localEnv.SMARTSPECTRA_API_KEY);

// Node's process.loadEnvFile does not overwrite a variable that is already in
// process.env, so this produces the same effective source as the measurement
// script without serializing either credential value.
if (existsSync(envFilePath)) process.loadEnvFile(envFilePath);

const effectiveKeySource = inheritedKeyExists
  ? 'process environment'
  : localCredential.nonempty
    ? 'local .env'
    : 'none';
const effectiveCredential = inspectCredentialShape(process.env.SMARTSPECTRA_API_KEY);
const sdkOptions = createSmartSpectraOptions(effectiveCredential.usable ? process.env.SMARTSPECTRA_API_KEY : undefined);

console.log(JSON.stringify({
  inheritedKeyExists,
  localEnvFileExists: existsSync(envFilePath),
  localEnvHasNonemptyApiKey: localCredential.nonempty,
  effectiveKeySource,
  effectiveApiKeyExists: effectiveCredential.exists,
  effectiveApiKeyNonempty: effectiveCredential.nonempty,
  effectiveApiKeyHasSurroundingWhitespace: effectiveCredential.hasSurroundingWhitespace,
  effectiveApiKeyHasSurroundingQuotes: effectiveCredential.hasSurroundingQuotes,
  sdkReceivesApiKeyViaDocumentedOption: Object.hasOwn(sdkOptions, 'apiKey')
    && ![undefined, ''].includes(sdkOptions.apiKey),
}));
