import type { CalibrationCliResponse } from './cli-core.js';
import type { Difficulty } from './types.js';

export type ShadowExecutionStatus = 'completed' | 'timeout' | 'nonzero_exit' | 'malformed_response' | 'calibration_error';

export interface ShadowComparisonContext {
  sessionId: string;
  questionId: string;
  answerId: string;
  /** The Python policy's applied next-question difficulty. */
  pythonSelectedDifficulty: Difficulty;
  schemaVersion: string;
}

export interface ShadowComparisonRecord {
  sessionId: string;
  questionId: string;
  answerId: string;
  /** Always the applied difficulty; shadow output never changes this value. */
  authoritativeDifficulty: Difficulty;
  pythonSelectedDifficulty: Difficulty;
  nodeRecommendedDifficulty?: Difficulty;
  agrees?: boolean;
  nodeExecutionStatus: ShadowExecutionStatus;
  executionDurationMs: number;
  schemaVersion: string;
}

function isDifficulty(value: unknown): value is Difficulty {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 5;
}

function validContext(context: ShadowComparisonContext): boolean {
  return Boolean(context.sessionId && context.questionId && context.answerId && context.schemaVersion && isDifficulty(context.pythonSelectedDifficulty));
}

function baseRecord(context: ShadowComparisonContext, status: ShadowExecutionStatus, durationMs: number): ShadowComparisonRecord {
  if (!validContext(context) || !Number.isFinite(durationMs) || durationMs < 0) {
    throw new TypeError('Shadow comparison context and duration must be valid.');
  }
  return {
    sessionId: context.sessionId,
    questionId: context.questionId,
    answerId: context.answerId,
    authoritativeDifficulty: context.pythonSelectedDifficulty,
    pythonSelectedDifficulty: context.pythonSelectedDifficulty,
    nodeExecutionStatus: status,
    executionDurationMs: durationMs,
    schemaVersion: context.schemaVersion,
  };
}

/**
 * Produce a transcript-free diagnostic record after the FastAPI-owned child
 * process has completed. The returned recommendation is comparison-only.
 */
export function buildShadowComparison(
  context: ShadowComparisonContext,
  execution: { status: Exclude<ShadowExecutionStatus, 'completed'>; durationMs: number } | { status: 'completed'; durationMs: number; response: CalibrationCliResponse },
): ShadowComparisonRecord {
  if (execution.status !== 'completed') return baseRecord(context, execution.status, execution.durationMs);
  const response = execution.response;
  if (!response || typeof response !== 'object') return baseRecord(context, 'malformed_response', execution.durationMs);
  if (!response.ok) {
    return baseRecord(context, response.error === 'calibration_error' ? 'calibration_error' : 'malformed_response', execution.durationMs);
  }
  const recommended = response.result.decision.recommendedDifficulty;
  if (!isDifficulty(recommended)) return baseRecord(context, 'malformed_response', execution.durationMs);
  return {
    ...baseRecord(context, 'completed', execution.durationMs),
    nodeRecommendedDifficulty: recommended,
    agrees: recommended === context.pythonSelectedDifficulty,
  };
}
