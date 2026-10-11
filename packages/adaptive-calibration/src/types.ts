export type Difficulty = 1 | 2 | 3 | 4 | 5;
export type CalibrationAction = 'increase' | 'maintain' | 'support' | 'pause';
export type PhysiologicalMetric = 'pulseRate' | 'breathingRate' | 'hrvRmssd';

export interface GeminiEvaluation {
  score: number;
  completedAt: string;
  valid: boolean;
}

export interface PerformanceHistoryEntry {
  score: number;
  recordedAt: string;
  completed: boolean;
}

export interface PhysiologicalSample {
  metric: PhysiologicalMetric;
  value: number;
  confidence: number;
  stable: boolean;
  measuredAt: string;
}

export interface PhysiologicalSummary {
  availability: {
    valid: boolean;
    measuredAt: string;
  };
  samples: readonly PhysiologicalSample[];
}

export interface PhysiologicalBaseline {
  metric: PhysiologicalMetric;
  value: number;
  measuredAt: string;
}

export interface PreviousAdaptationDecision {
  action: CalibrationAction;
  recommendedDifficulty: Difficulty;
  timestamp: string;
  difficultyChanged: boolean;
}

export interface SessionContext {
  sessionId: string;
  startedAt: string;
  /** Explicitly enables the narrow, non-diagnostic physiological pacing guard. */
  allowPhysiologicalPacing: boolean;
}

export interface CalibrationInput {
  currentDifficulty: Difficulty;
  geminiEvaluations: readonly GeminiEvaluation[];
  performanceHistory: readonly PerformanceHistoryEntry[];
  physiologicalConsent: boolean;
  physiological?: PhysiologicalSummary;
  physiologicalBaselines?: readonly PhysiologicalBaseline[];
  previousDecisions: readonly PreviousAdaptationDecision[];
  session: SessionContext;
  /** Caller-owned clock value; the engine never reads the system clock. */
  decisionTimestamp: string;
}

export interface CalibrationConfig {
  cooldownMs?: number;
  physiologicalFreshnessMs?: number;
  minimumPhysiologicalConfidence?: number;
  pacingDeviationThreshold?: number;
}

export interface CalibrationEvidence {
  rule: string;
  validEvaluationCount: number;
  evaluationScoresUsed: number[];
  averageScore?: number;
  cooldownActive: boolean;
  physiological: {
    consentGranted: boolean;
    considered: boolean;
    used: boolean;
    exclusionReasons: string[];
    matchedMetrics: PhysiologicalMetric[];
  };
}

export interface CalibrationDecision {
  action: CalibrationAction;
  recommendedDifficulty: Difficulty;
  reason: string;
  usedPhysiologicalData: boolean;
  evidence: CalibrationEvidence;
  timestamp: string;
  contractVersion: '1.0.0';
}
