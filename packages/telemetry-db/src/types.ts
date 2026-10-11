export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export interface QueryResult<T = Record<string, unknown>> { rows: T[]; rowCount: number | null; }
export interface SqlClient { query<T = Record<string, unknown>>(text: string, values?: readonly unknown[]): Promise<QueryResult<T>>; }
export interface SessionInput { sessionId: string; pseudonymousUserId: string; startedAt: string; status: 'active'|'completed'|'abandoned'; physiologyConsent: boolean; consentReference?: string; metadata?: Json; }
export interface EventInput { eventId: string; sessionId: string; timestamp: string; type: 'question'|'answer'|'gemini_evaluation'; questionId?: string; payload: Json; schemaVersion: string; idempotencyKey: string; }
export interface DecisionInput { decisionId: string; sessionId: string; timestamp: string; action: 'increase'|'maintain'|'support'|'pause'; previousDifficulty: number; recommendedDifficulty: number; reason: string; contractVersion: string; answerScoreAggregate?: number; physiologyUsed: boolean; evidence: Json; idempotencyKey: string; }
export interface PhysiologyInput { summaryId: string; sessionId: string; timestamp: string; metricType: 'pulseRate'|'breathingRate'|'hrvRmssd'; aggregateValue: number; unit?: string; confidence?: number; stable: boolean; valid: boolean; consentReference: string; idempotencyKey: string; }
export interface TimelineItem { source: 'event'|'calibration_decision'|'physiology_summary'; eventTimestamp: string; tieBreaker: string; payload: Json; }
