import { Pool } from 'pg';
import type { PoolClient } from 'pg';
import { analytics, timelineSql } from './queries.js';
import type { DecisionInput, EventInput, PhysiologyInput, SessionInput, SqlClient, TimelineItem } from './types.js';
import { finite, json, required, timestamp, TelemetryValidationError } from './validation.js';

type TransactionClient = SqlClient & { release?: () => void };
const isDifficulty = (value: number) => Number.isInteger(value) && value >= 1 && value <= 5;
export class TelemetryStore {
  constructor(private readonly database: SqlClient | Pool) {}
  private client(): SqlClient { return this.database as unknown as SqlClient; }
  private async transaction<T>(work: (client: SqlClient) => Promise<T>): Promise<T> {
    const pool = this.database as Pool;
    if (!('connect' in pool)) return work(this.client());
    const client = await pool.connect() as PoolClient & TransactionClient;
    try { await client.query('BEGIN'); const result = await work(client); await client.query('COMMIT'); return result; }
    catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
  async createSession(input: SessionInput): Promise<void> {
    required(input.sessionId,'sessionId'); required(input.pseudonymousUserId,'pseudonymousUserId'); timestamp(input.startedAt,'startedAt'); json(input.metadata ?? {},'metadata');
    await this.client().query(`INSERT INTO interview_sessions (session_id,pseudonymous_user_id,started_at,status,physiology_consent,consent_reference,session_metadata) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [input.sessionId,input.pseudonymousUserId,input.startedAt,input.status,input.physiologyConsent,input.consentReference ?? null,input.metadata ?? {}]);
  }
  async insertEvent(input: EventInput): Promise<boolean> {
    required(input.eventId,'eventId'); required(input.sessionId,'sessionId'); required(input.idempotencyKey,'idempotencyKey'); timestamp(input.timestamp,'timestamp'); required(input.schemaVersion,'schemaVersion'); json(input.payload,'payload');
    const result = await this.client().query(`INSERT INTO interview_events (event_id,session_id,event_timestamp,event_type,question_id,event_payload,schema_version,idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (session_id,idempotency_key) DO NOTHING RETURNING event_id`, [input.eventId,input.sessionId,input.timestamp,input.type,input.questionId ?? null,input.payload,input.schemaVersion,input.idempotencyKey]);
    return result.rows.length > 0;
  }
  async insertDecision(input: DecisionInput): Promise<boolean> {
    required(input.decisionId,'decisionId'); required(input.sessionId,'sessionId'); required(input.idempotencyKey,'idempotencyKey'); timestamp(input.timestamp,'timestamp'); if (!isDifficulty(input.previousDifficulty)||!isDifficulty(input.recommendedDifficulty)) throw new TelemetryValidationError('difficulty must be an integer from 1 to 5.'); if (input.answerScoreAggregate !== undefined) finite(input.answerScoreAggregate,'answerScoreAggregate',0,1); json(input.evidence,'evidence');
    const result = await this.client().query(`INSERT INTO calibration_decisions (decision_id,session_id,event_timestamp,action,previous_difficulty,recommended_difficulty,decision_reason,contract_version,answer_score_aggregate,physiology_used,structured_evidence,idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (session_id,idempotency_key) DO NOTHING RETURNING decision_id`, [input.decisionId,input.sessionId,input.timestamp,input.action,input.previousDifficulty,input.recommendedDifficulty,input.reason,input.contractVersion,input.answerScoreAggregate ?? null,input.physiologyUsed,input.evidence,input.idempotencyKey]);
    return result.rows.length > 0;
  }
  async insertPhysiology(input: PhysiologyInput): Promise<boolean> { return this.transaction(async (client) => {
    required(input.consentReference,'consentReference'); timestamp(input.timestamp,'timestamp'); finite(input.aggregateValue,'aggregateValue'); if (input.confidence !== undefined) finite(input.confidence,'confidence',0,100);
    const consent = await client.query<{ physiology_consent: boolean }>('SELECT physiology_consent FROM interview_sessions WHERE session_id = $1 FOR UPDATE',[input.sessionId]);
    if (!consent.rows.length) throw new TelemetryValidationError('session does not exist.'); if (!consent.rows[0].physiology_consent) throw new TelemetryValidationError('physiological telemetry requires session consent.');
    const claim = await client.query(`INSERT INTO telemetry_idempotency (session_id,record_type,idempotency_key) VALUES ($1,'physiology_summary',$2) ON CONFLICT DO NOTHING RETURNING idempotency_key`,[input.sessionId,input.idempotencyKey]);
    if (!claim.rows.length) return false;
    await client.query(`INSERT INTO physiological_metric_summaries (summary_id,session_id,event_timestamp,metric_type,aggregate_value,unit,confidence,stable,valid,consent_reference) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[input.summaryId,input.sessionId,input.timestamp,input.metricType,input.aggregateValue,input.unit ?? null,input.confidence ?? null,input.stable,input.valid,input.consentReference]); return true;
  }); }
  async replay(sessionId: string, authorization: { includePhysiology?: boolean; authorizedForPhysiology?: boolean } = {}): Promise<TimelineItem[]> { required(sessionId,'sessionId'); if (authorization.includePhysiology && !authorization.authorizedForPhysiology) throw new TelemetryValidationError('physiological replay requires explicit authorization.'); const result = await this.client().query<TimelineItem>(timelineSql(Boolean(authorization.includePhysiology)),[sessionId]); return result.rows; }
  analytics() { return analytics; }
}
export function telemetryStoreFromDatabaseUrl(databaseUrl = process.env.DATABASE_URL): TelemetryStore {
  if (!databaseUrl) throw new TelemetryValidationError('DATABASE_URL is required.');
  return new TelemetryStore(new Pool({ connectionString: databaseUrl }));
}
