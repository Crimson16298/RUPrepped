import type {
  CalibrationAction,
  CalibrationConfig,
  CalibrationDecision,
  CalibrationEvidence,
  CalibrationInput,
  Difficulty,
  PhysiologicalMetric,
  PhysiologicalSample,
} from './types.js';

const DEFAULTS = {
  cooldownMs: 120_000,
  physiologicalFreshnessMs: 30_000,
  minimumPhysiologicalConfidence: 70,
  pacingDeviationThreshold: 0.25,
} as const;

export class CalibrationInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CalibrationInputError';
  }
}

function isDifficulty(value: unknown): value is Difficulty {
  return Number.isInteger(value) && typeof value === 'number' && value >= 1 && value <= 5;
}

function timestampMs(value: string, label: string): number {
  if (typeof value !== 'string' || !value) throw new CalibrationInputError(`${label} must be a nonempty ISO timestamp.`);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new CalibrationInputError(`${label} must be a valid ISO timestamp.`);
  return parsed;
}

function normalizedScore(value: number, label: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new CalibrationInputError(`${label} must be a normalized number from 0 to 1.`);
  }
}

function finiteNumber(value: number, label: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new CalibrationInputError(`${label} must be finite.`);
}

function resolveConfig(config: CalibrationConfig): Required<CalibrationConfig> {
  const resolved = { ...DEFAULTS, ...config };
  for (const [key, value] of Object.entries(resolved)) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new CalibrationInputError(`${key} must be a nonnegative finite number.`);
    }
  }
  if (resolved.minimumPhysiologicalConfidence > 100) {
    throw new CalibrationInputError('minimumPhysiologicalConfidence cannot exceed 100.');
  }
  return resolved;
}

function validateInput(input: CalibrationInput): void {
  if (!input || typeof input !== 'object') throw new CalibrationInputError('input must be an object.');
  if (!isDifficulty(input.currentDifficulty)) throw new CalibrationInputError('currentDifficulty must be an integer from 1 to 5.');
  if (!Array.isArray(input.geminiEvaluations)) throw new CalibrationInputError('geminiEvaluations must be an array.');
  if (!Array.isArray(input.performanceHistory)) throw new CalibrationInputError('performanceHistory must be an array.');
  if (!Array.isArray(input.previousDecisions)) throw new CalibrationInputError('previousDecisions must be an array.');
  if (typeof input.physiologicalConsent !== 'boolean') throw new CalibrationInputError('physiologicalConsent must be boolean.');
  if (!input.session || typeof input.session.sessionId !== 'string' || !input.session.sessionId) {
    throw new CalibrationInputError('session.sessionId must be nonempty.');
  }
  if (typeof input.session.allowPhysiologicalPacing !== 'boolean') {
    throw new CalibrationInputError('session.allowPhysiologicalPacing must be boolean.');
  }
  timestampMs(input.session.startedAt, 'session.startedAt');
  timestampMs(input.decisionTimestamp, 'decisionTimestamp');

  input.geminiEvaluations.forEach((evaluation, index) => {
    if (!evaluation || typeof evaluation.valid !== 'boolean') throw new CalibrationInputError(`geminiEvaluations[${index}].valid must be boolean.`);
    normalizedScore(evaluation.score, `geminiEvaluations[${index}].score`);
    timestampMs(evaluation.completedAt, `geminiEvaluations[${index}].completedAt`);
  });
  input.performanceHistory.forEach((entry, index) => {
    if (!entry || typeof entry.completed !== 'boolean') throw new CalibrationInputError(`performanceHistory[${index}].completed must be boolean.`);
    normalizedScore(entry.score, `performanceHistory[${index}].score`);
    timestampMs(entry.recordedAt, `performanceHistory[${index}].recordedAt`);
  });
  input.previousDecisions.forEach((decision, index) => {
    if (!decision || !['increase', 'maintain', 'support', 'pause'].includes(decision.action)) throw new CalibrationInputError(`previousDecisions[${index}].action is invalid.`);
    if (!isDifficulty(decision.recommendedDifficulty)) throw new CalibrationInputError(`previousDecisions[${index}].recommendedDifficulty is invalid.`);
    if (typeof decision.difficultyChanged !== 'boolean') throw new CalibrationInputError(`previousDecisions[${index}].difficultyChanged must be boolean.`);
    timestampMs(decision.timestamp, `previousDecisions[${index}].timestamp`);
  });
  if (!input.physiological) return;
  const { availability, samples } = input.physiological;
  if (!availability || typeof availability.valid !== 'boolean') throw new CalibrationInputError('physiological.availability.valid must be boolean.');
  timestampMs(availability.measuredAt, 'physiological.availability.measuredAt');
  if (!Array.isArray(samples)) throw new CalibrationInputError('physiological.samples must be an array.');
  samples.forEach((sample, index) => validateSample(sample, index));
  (input.physiologicalBaselines ?? []).forEach((baseline, index) => {
    if (!baseline || !['pulseRate', 'breathingRate', 'hrvRmssd'].includes(baseline.metric)) throw new CalibrationInputError(`physiologicalBaselines[${index}].metric is invalid.`);
    finiteNumber(baseline.value, `physiologicalBaselines[${index}].value`);
    timestampMs(baseline.measuredAt, `physiologicalBaselines[${index}].measuredAt`);
  });
}

function validateSample(sample: PhysiologicalSample, index: number): void {
  if (!sample || !['pulseRate', 'breathingRate', 'hrvRmssd'].includes(sample.metric)) throw new CalibrationInputError(`physiological.samples[${index}].metric is invalid.`);
  finiteNumber(sample.value, `physiological.samples[${index}].value`);
  if (typeof sample.confidence !== 'number' || !Number.isFinite(sample.confidence) || sample.confidence < 0 || sample.confidence > 100) throw new CalibrationInputError(`physiological.samples[${index}].confidence must be from 0 to 100.`);
  if (typeof sample.stable !== 'boolean') throw new CalibrationInputError(`physiological.samples[${index}].stable must be boolean.`);
  timestampMs(sample.measuredAt, `physiological.samples[${index}].measuredAt`);
}

function latestValidScores(input: CalibrationInput): number[] {
  return input.geminiEvaluations
    .map((evaluation, index) => ({ evaluation, index, timestamp: timestampMs(evaluation.completedAt, 'gemini evaluation timestamp') }))
    .filter(({ evaluation }) => evaluation.valid)
    .sort((a, b) => b.timestamp - a.timestamp || b.index - a.index)
    .slice(0, 3)
    .map(({ evaluation }) => evaluation.score);
}

function physiologicalEvidence(input: CalibrationInput, config: Required<CalibrationConfig>): CalibrationEvidence['physiological'] {
  const result: CalibrationEvidence['physiological'] = {
    consentGranted: input.physiologicalConsent,
    considered: false,
    used: false,
    exclusionReasons: [],
    matchedMetrics: [],
  };
  if (!input.physiologicalConsent) { result.exclusionReasons.push('consent_not_granted'); return result; }
  if (!input.session.allowPhysiologicalPacing) { result.exclusionReasons.push('pacing_not_enabled_for_session'); return result; }
  if (!input.physiological) { result.exclusionReasons.push('no_physiological_measurement'); return result; }
  result.considered = true;
  if (!input.physiological.availability.valid) { result.exclusionReasons.push('measurement_not_valid'); return result; }
  const now = timestampMs(input.decisionTimestamp, 'decisionTimestamp');
  const baselines = new Map((input.physiologicalBaselines ?? []).map((baseline) => [baseline.metric, baseline]));
  const usable: PhysiologicalMetric[] = [];
  for (const sample of [...input.physiological.samples].sort((a, b) => a.metric.localeCompare(b.metric))) {
    const ageMs = now - timestampMs(sample.measuredAt, 'physiological sample timestamp');
    const baseline = baselines.get(sample.metric);
    if (ageMs < 0 || ageMs > config.physiologicalFreshnessMs) continue;
    if (sample.confidence < config.minimumPhysiologicalConfidence || !sample.stable || !baseline) continue;
    const relativeDeviation = Math.abs(sample.value - baseline.value) / Math.max(Math.abs(baseline.value), 1);
    if (relativeDeviation >= config.pacingDeviationThreshold) usable.push(sample.metric);
  }
  if (!usable.length) { result.exclusionReasons.push('no_fresh_valid_baseline_matched_sample'); return result; }
  result.matchedMetrics = usable;
  return result;
}

function cooldownActive(input: CalibrationInput, cooldownMs: number): boolean {
  const latest = input.previousDecisions
    .filter((decision) => decision.difficultyChanged)
    .map((decision, index) => ({ timestamp: timestampMs(decision.timestamp, 'previous decision timestamp'), index }))
    .sort((a, b) => b.timestamp - a.timestamp || b.index - a.index)[0];
  return Boolean(latest && timestampMs(input.decisionTimestamp, 'decisionTimestamp') - latest.timestamp < cooldownMs);
}

export function calibrate(input: CalibrationInput, config: CalibrationConfig = {}): CalibrationDecision {
  validateInput(input);
  const resolved = resolveConfig(config);
  const scores = latestValidScores(input);
  const average = scores.length ? scores.reduce((total, score) => total + score, 0) / scores.length : undefined;
  const evidence: CalibrationEvidence = {
    rule: '', validEvaluationCount: scores.length, evaluationScoresUsed: scores,
    averageScore: average, cooldownActive: false,
    physiological: physiologicalEvidence(input, resolved),
  };
  let action: CalibrationAction = 'maintain';
  let recommendedDifficulty: Difficulty = input.currentDifficulty;
  let reason = 'insufficient_valid_evaluations';

  if (scores.length >= 2 && average !== undefined) {
    if (average >= 0.85) { action = 'increase'; recommendedDifficulty = Math.min(5, input.currentDifficulty + 1) as Difficulty; reason = 'high_recent_answer_quality'; }
    else if (average < 0.60) { action = 'support'; recommendedDifficulty = Math.max(1, input.currentDifficulty - 1) as Difficulty; reason = 'low_recent_answer_quality'; }
    else { reason = 'moderate_recent_answer_quality'; }
  }
  evidence.rule = reason;
  const changesDifficulty = recommendedDifficulty !== input.currentDifficulty;
  evidence.cooldownActive = changesDifficulty && cooldownActive(input, resolved.cooldownMs);
  if (evidence.cooldownActive) { action = 'maintain'; recommendedDifficulty = input.currentDifficulty; reason = 'cooldown_prevents_difficulty_change'; evidence.rule = reason; }

  // Physiology never raises difficulty and never represents a psychological conclusion.
  if (action === 'maintain' && reason === 'moderate_recent_answer_quality' && evidence.physiological.matchedMetrics.length > 0) {
    action = 'support';
    reason = 'conservative_physiological_pacing_guard';
    evidence.rule = reason;
    evidence.physiological.used = true;
  }
  return { action, recommendedDifficulty, reason, usedPhysiologicalData: evidence.physiological.used, evidence, timestamp: input.decisionTimestamp, contractVersion: '1.0.0' };
}
