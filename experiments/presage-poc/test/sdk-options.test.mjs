import assert from 'node:assert/strict';
import test from 'node:test';
import { SmartSpectraLogLevel } from '@smartspectra/node-sdk';
import { classifySmartSpectraError, createSmartSpectraOptions } from '../src/sdk-options.mjs';
import { inspectCredentialShape } from '../src/credential-shape.mjs';

test('builds the documented SmartSpectra apiKey constructor option', () => {
  const options = createSmartSpectraOptions('test-key-not-a-real-credential');
  assert.equal(options.apiKey, 'test-key-not-a-real-credential');
  assert.ok(Array.isArray(options.requestedMetrics));
  assert.equal(options.logLevel, SmartSpectraLogLevel.kError);
  assert.equal(options.enableTelemetry, false);
});

test('classifies installed SmartSpectra authentication error code', () => {
  assert.equal(classifySmartSpectraError(2), 'authenticationFailed');
});

test('rejects only malformed effective credential shapes without exposing them', () => {
  assert.equal(inspectCredentialShape('valid-key').usable, true);
  assert.equal(inspectCredentialShape(' valid-key').hasSurroundingWhitespace, true);
  assert.equal(inspectCredentialShape("'valid-key'").hasSurroundingQuotes, true);
});
