import { calibrate } from './engine.js';
import type { CalibrationDecision, CalibrationInput, Difficulty } from './types.js';

/**
 * Narrow port implemented by a Node-side adapter around TelemetryStore.
 * FastAPI sends the request across a process boundary; it never imports this
 * TypeScript module directly.
 */
export interface TelemetryPort {
  insertEvent(input: {
    eventId: string; sessionId: string; timestamp: string;
    type: 'gemini_evaluation'; questionId?: string; payload: unknown;
    schemaVersion: string; idempotencyKey: string;
  }): Promise<boolean>;
  insertDecision(input: {
    decisionId: string; sessionId: string; timestamp: string;
    action: CalibrationDecision['action']; previousDifficulty: Difficulty;
    recommendedDifficulty: Difficulty; reason: string; contractVersion: string;
    answerScoreAggregate?: number; physiologyUsed: boolean; evidence: unknown;
    idempotencyKey: string;
  }): Promise<boolean>;
}

export interface IntegrationRequest {
  calibration: CalibrationInput;
  telemetry?: {
    event: Parameters<TelemetryPort['insertEvent']>[0];
    decisionId: string;
    decisionIdempotencyKey: string;
  };
}

export interface IntegrationResult {
  decision: CalibrationDecision;
  camera: 'not_provided_or_unavailable' | 'consent_not_granted' | 'measurement_not_valid' | 'available';
  telemetry: 'not_configured' | 'persisted' | 'duplicate' | 'unavailable';
}

function cameraStatus(input: CalibrationInput): IntegrationResult['camera'] {
  if (!input.physiological) return 'not_provided_or_unavailable';
  if (!input.physiologicalConsent) return 'consent_not_granted';
  return input.physiological.availability.valid ? 'available' : 'measurement_not_valid';
}

/**
 * Calculates immediately, then makes best-effort telemetry writes. Database
 * failures never reject this function or interrupt the interview decision.
 */
export async function coordinateInterviewTurn(request: IntegrationRequest, telemetryPort?: TelemetryPort): Promise<IntegrationResult> {
  const decision = calibrate(request.calibration);
  const result: IntegrationResult = { decision, camera: cameraStatus(request.calibration), telemetry: 'not_configured' };
  if (!telemetryPort || !request.telemetry) return result;
  try {
    const eventInserted = await telemetryPort.insertEvent(request.telemetry.event);
    const decisionInserted = await telemetryPort.insertDecision({
      decisionId: request.telemetry.decisionId,
      sessionId: request.calibration.session.sessionId,
      timestamp: decision.timestamp,
      action: decision.action,
      previousDifficulty: request.calibration.currentDifficulty,
      recommendedDifficulty: decision.recommendedDifficulty,
      reason: decision.reason,
      contractVersion: decision.contractVersion,
      answerScoreAggregate: decision.evidence.averageScore,
      physiologyUsed: decision.usedPhysiologicalData,
      evidence: decision.evidence,
      idempotencyKey: request.telemetry.decisionIdempotencyKey,
    });
    result.telemetry = eventInserted && decisionInserted ? 'persisted' : 'duplicate';
  } catch {
    result.telemetry = 'unavailable';
  }
  return result;
}
