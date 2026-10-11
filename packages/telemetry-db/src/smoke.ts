import { randomUUID } from 'node:crypto';
import { approvedDatabaseConfig, requireConfirmation } from './database-config.js';
import { TelemetryStore } from './adapter.js';
import { analytics } from './queries.js';

async function main(): Promise<void> {
  requireConfirmation('TELEMETRY_SMOKE_CONFIRM', 'run-synthetic-development');
  const { pool } = approvedDatabaseConfig();
  const sessionId = randomUUID(); const noConsentSessionId = randomUUID();
  const now = new Date().toISOString(); const store = new TelemetryStore(pool);
  try {
    await store.createSession({ sessionId, pseudonymousUserId: `synthetic-${sessionId}`, startedAt: now, status: 'active', physiologyConsent: true, consentReference: 'synthetic-consent', metadata: { synthetic: true } });
    await store.createSession({ sessionId: noConsentSessionId, pseudonymousUserId: `synthetic-${noConsentSessionId}`, startedAt: now, status: 'active', physiologyConsent: false, metadata: { synthetic: true } });
    await store.insertEvent({ eventId: randomUUID(), sessionId, timestamp: now, type: 'question', questionId: 'synthetic-q', payload: { synthetic: true }, schemaVersion: '1', idempotencyKey: 'question-1' });
    const answer = { eventId: randomUUID(), sessionId, timestamp: now, type: 'answer' as const, questionId: 'synthetic-q', payload: { synthetic: true, answer: 'example' }, schemaVersion: '1', idempotencyKey: 'answer-1' };
    await store.insertEvent(answer); const duplicateRejected = !(await store.insertEvent(answer));
    await store.insertEvent({ eventId: randomUUID(), sessionId, timestamp: now, type: 'gemini_evaluation', payload: { synthetic: true, score: 0.7, skillCategory: 'general' }, schemaVersion: '1', idempotencyKey: 'evaluation-1' });
    await store.insertDecision({ decisionId: randomUUID(), sessionId, timestamp: now, action: 'maintain', previousDifficulty: 3, recommendedDifficulty: 3, reason: 'synthetic_smoke', contractVersion: '1.0.0', answerScoreAggregate: .7, physiologyUsed: false, evidence: { synthetic: true }, idempotencyKey: 'decision-1' });
    let consentRejected = false; try { await store.insertPhysiology({ summaryId: randomUUID(), sessionId: noConsentSessionId, timestamp: now, metricType: 'pulseRate', aggregateValue: 70, unit: 'bpm', confidence: 90, stable: true, valid: true, consentReference: 'synthetic', idempotencyKey: 'phys-1' }); } catch { consentRejected = true; }
    await store.insertPhysiology({ summaryId: randomUUID(), sessionId, timestamp: now, metricType: 'pulseRate', aggregateValue: 70, unit: 'bpm', confidence: 90, stable: true, valid: true, consentReference: 'synthetic-consent', idempotencyKey: 'phys-1' });
    const replay = await store.replay(sessionId, { includePhysiology: true, authorizedForPhysiology: true });
    await Promise.all(Object.values(analytics).map((sql) => pool.query(sql, sql.includes('$1') ? [sessionId] : [])));
    const timescale = await pool.query(`SELECT extname, extversion FROM pg_extension WHERE extname = 'timescaledb'`);
    console.log(JSON.stringify({ synthetic: true, replayItems: replay.length, duplicateRejected, consentRejected, timescaleInstalled: timescale.rows.length > 0 }));
  } finally {
    // Only UUIDs created by this run are removed, in dependency order.
    await pool.query('DELETE FROM telemetry_idempotency WHERE session_id = ANY($1::uuid[])', [[sessionId,noConsentSessionId]]);
    await pool.query('DELETE FROM physiological_metric_summaries WHERE session_id = ANY($1::uuid[])', [[sessionId,noConsentSessionId]]);
    await pool.query('DELETE FROM interview_events WHERE session_id = ANY($1::uuid[])', [[sessionId,noConsentSessionId]]);
    await pool.query('DELETE FROM calibration_decisions WHERE session_id = ANY($1::uuid[])', [[sessionId,noConsentSessionId]]);
    await pool.query('DELETE FROM interview_sessions WHERE session_id = ANY($1::uuid[])', [[sessionId,noConsentSessionId]]);
    await pool.end();
  }
}
main().catch((error: Error) => { console.error(`Synthetic smoke test failed: ${error.message}`); process.exitCode = 1; });
