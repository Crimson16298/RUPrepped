import type { CalibrationDecision, CalibrationInput, GeminiEvaluation, PerformanceHistoryEntry } from './types.js';
import type { IntegrationRequest } from './integration.js';

/** Versioned, JSON-only request contract for a FastAPI-to-Node subprocess. */
export const FASTAPI_CALIBRATION_SCHEMA_VERSION = '1.0.0' as const;

type PercentScored<T extends { score: number }> = Omit<T, 'score'> & { score: number };

/**
 * FastAPI evaluates answers on an integer 0–100 scale. This boundary converts
 * those scores before the deterministic engine receives them.
 */
export interface FastApiCalibrationRequest {
  schemaVersion: typeof FASTAPI_CALIBRATION_SCHEMA_VERSION;
  calibration: Omit<CalibrationInput, 'geminiEvaluations' | 'performanceHistory'> & {
    geminiEvaluations: readonly PercentScored<GeminiEvaluation>[];
    performanceHistory: readonly PercentScored<PerformanceHistoryEntry>[];
  };
}

export class FastApiBoundaryError extends Error {
  constructor(readonly code: 'invalid_request' | 'unsupported_schema_version') {
    super(code);
    this.name = 'FastApiBoundaryError';
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** Convert one FastAPI score without accepting ambiguous normalized values. */
export function normalizeGeminiScore(score: unknown): number {
  if (typeof score !== 'number' || !Number.isInteger(score) || score < 0 || score > 100) {
    throw new FastApiBoundaryError('invalid_request');
  }
  return score / 100;
}

function normalizePercentScoredEntries(values: unknown): Record<string, unknown>[] {
  if (!Array.isArray(values)) throw new FastApiBoundaryError('invalid_request');
  return values.map((value) => {
    if (!record(value) || !('score' in value)) throw new FastApiBoundaryError('invalid_request');
    return { ...value, score: normalizeGeminiScore(value.score) };
  });
}

/**
 * Validate the outer wire contract and return the existing worker request.
 * Remaining calibration-field validation deliberately remains in calibrate().
 */
export function toIntegrationRequest(value: unknown): IntegrationRequest {
  if (!record(value) || !record(value.calibration)) throw new FastApiBoundaryError('invalid_request');
  if (value.schemaVersion !== FASTAPI_CALIBRATION_SCHEMA_VERSION) {
    throw new FastApiBoundaryError('unsupported_schema_version');
  }
  const calibration = value.calibration;
  return {
    calibration: {
      ...calibration,
      geminiEvaluations: normalizePercentScoredEntries(calibration.geminiEvaluations) as unknown as readonly GeminiEvaluation[],
      performanceHistory: normalizePercentScoredEntries(calibration.performanceHistory) as unknown as readonly PerformanceHistoryEntry[],
    } as CalibrationInput,
  };
}

/** Existing frontend vocabulary cannot represent pacing-only support or pause. */
export type ExistingFrontendDifficultyDecision = 'increase' | 'maintain' | 'decrease';

export function toExistingFrontendDifficultyDecision(decision: CalibrationDecision, previousDifficulty: number): ExistingFrontendDifficultyDecision {
  if (decision.action === 'increase') return 'increase';
  if (decision.action === 'support' && decision.recommendedDifficulty < previousDifficulty) return 'decrease';
  // Pacing-only support and pause require a future frontend status field.
  return 'maintain';
}
