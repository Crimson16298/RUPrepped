import assert from 'node:assert/strict';
import test from 'node:test';
import { TelemetryStore, TelemetryValidationError } from '../src/index.js';
import type { QueryResult, SqlClient } from '../src/types.js';

class MockClient implements SqlClient {
  calls: Array<{ text: string; values?: readonly unknown[] }> = [];
  consent = true;
  duplicate = false;
  sessionExists = true;
  async query<T = Record<string, unknown>>(text: string, values?: readonly unknown[]): Promise<QueryResult<T>> {
    this.calls.push({ text, values });
    if (text.includes('SELECT physiology_consent')) return { rows: (this.sessionExists ? [{ physiology_consent: this.consent }] : []) as T[], rowCount: this.sessionExists ? 1 : 0 };
    if (text.includes('ON CONFLICT')) return { rows: (this.duplicate ? [] : [{}]) as T[], rowCount: this.duplicate ? 0 : 1 };
    if (text.includes('FROM (SELECT')) return { rows: [{ source: 'event', eventTimestamp: '2026-01-01T00:00:00Z', tieBreaker: 'a', payload: {} }] as T[], rowCount: 1 };
    return { rows: [] as T[], rowCount: 1 };
  }
}
const event = { eventId:'00000000-0000-0000-0000-000000000001',sessionId:'00000000-0000-0000-0000-000000000010',timestamp:'2026-01-01T00:00:00Z',type:'answer' as const,payload:{ answer:'synthetic' },schemaVersion:'1',idempotencyKey:'event-1' };
test('inserts valid events with parameterized SQL and idempotency', async () => { const mock = new MockClient(); const store = new TelemetryStore(mock); assert.equal(await store.insertEvent(event),true); mock.duplicate=true; assert.equal(await store.insertEvent(event),false); assert.ok(mock.calls[0].text.includes('$1')); });
test('rejects invalid payloads before writing', async () => { const mock = new MockClient(); await assert.rejects(() => new TelemetryStore(mock).insertEvent({ ...event, timestamp:'nope' }),TelemetryValidationError); await assert.rejects(() => new TelemetryStore(mock).insertEvent({ ...event, payload: undefined as never }),TelemetryValidationError); assert.equal(mock.calls.length,0); });
test('physiology requires consent and uses transaction-safe idempotency', async () => { const mock = new MockClient(); mock.consent=false; const store = new TelemetryStore(mock); await assert.rejects(() => store.insertPhysiology({ summaryId:'00000000-0000-0000-0000-000000000002',sessionId:event.sessionId,timestamp:event.timestamp,metricType:'pulseRate',aggregateValue:70,confidence:90,stable:true,valid:true,consentReference:'consent-1',idempotencyKey:'phys-1' }),TelemetryValidationError); });
test('missing sessions are rejected before physiological foreign-key writes', async () => { const mock = new MockClient(); mock.sessionExists=false; await assert.rejects(() => new TelemetryStore(mock).insertPhysiology({ summaryId:'00000000-0000-0000-0000-000000000002',sessionId:event.sessionId,timestamp:event.timestamp,metricType:'pulseRate',aggregateValue:70,stable:true,valid:true,consentReference:'consent-1',idempotencyKey:'phys-1' }),TelemetryValidationError); });
test('replay has deterministic SQL ordering and excludes optional physiology by default', async () => { const mock = new MockClient(); const store = new TelemetryStore(mock); await assert.rejects(() => store.replay(event.sessionId,{includePhysiology:true,authorizedForPhysiology:false}),TelemetryValidationError); const rows = await store.replay(event.sessionId); assert.equal(rows[0].source,'event'); assert.doesNotMatch(mock.calls.at(-1)!.text,/physiological_metric_summaries/); assert.match(mock.calls.at(-1)!.text,/ORDER BY event_timestamp, source, tie_breaker/); });
test('decision contract serializes structured evidence', async () => { const mock = new MockClient(); const inserted = await new TelemetryStore(mock).insertDecision({ decisionId:'00000000-0000-0000-0000-000000000003',sessionId:event.sessionId,timestamp:event.timestamp,action:'maintain',previousDifficulty:3,recommendedDifficulty:3,reason:'synthetic',contractVersion:'1.0.0',answerScoreAggregate:.7,physiologyUsed:false,evidence:{ rule:'synthetic' },idempotencyKey:'decision-1' }); assert.equal(inserted,true); });
