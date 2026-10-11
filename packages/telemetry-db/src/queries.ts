import type { TimelineItem } from './types.js';
export const analytics = {
  sessionProgress: `SELECT date_trunc('minute', event_timestamp) AS bucket, count(*) AS event_count FROM interview_events WHERE session_id = $1 GROUP BY 1 ORDER BY 1`,
  averageAnswerQualityBySkill: `SELECT event_payload->>'skillCategory' AS skill_category, avg((event_payload->>'score')::double precision) AS average_score FROM interview_events WHERE event_type = 'gemini_evaluation' AND event_payload ? 'score' GROUP BY 1 ORDER BY 1`,
  difficultyChanges: `SELECT event_timestamp, previous_difficulty, recommended_difficulty, action FROM calibration_decisions WHERE session_id = $1 ORDER BY event_timestamp, decision_id`,
  calibrationFrequency: `SELECT action, count(*) AS count FROM calibration_decisions GROUP BY action ORDER BY action`,
  optedInPhysiologyAvailability: `SELECT metric_type, count(*) FILTER (WHERE valid) AS valid_count, count(*) AS total_count FROM physiological_metric_summaries GROUP BY metric_type ORDER BY metric_type`,
};
export function timelineSql(includePhysiology: boolean): string {
  const physiology = includePhysiology ? `UNION ALL SELECT event_timestamp, 'physiology_summary'::text AS source, summary_id::text AS tie_breaker, jsonb_build_object('metricType',metric_type,'value',aggregate_value,'unit',unit,'confidence',confidence,'stable',stable,'valid',valid) AS payload FROM physiological_metric_summaries WHERE session_id = $1` : '';
  return `SELECT event_timestamp AS "eventTimestamp", source, tie_breaker AS "tieBreaker", payload FROM (SELECT event_timestamp, 'event'::text AS source, event_id::text AS tie_breaker, event_payload AS payload FROM interview_events WHERE session_id = $1 UNION ALL SELECT event_timestamp, 'calibration_decision'::text AS source, decision_id::text AS tie_breaker, jsonb_build_object('action',action,'previousDifficulty',previous_difficulty,'recommendedDifficulty',recommended_difficulty,'reason',decision_reason,'physiologyUsed',physiology_used,'evidence',structured_evidence) AS payload FROM calibration_decisions WHERE session_id = $1 ${physiology}) timeline ORDER BY event_timestamp, source, tie_breaker;`;
}
export type { TimelineItem };
