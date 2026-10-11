import { calibrate } from './index.js';
import type { CalibrationInput } from './types.js';

const timestamp = '2026-10-10T19:00:00.000Z';
const base: Omit<CalibrationInput, 'currentDifficulty' | 'geminiEvaluations' | 'physiological' | 'physiologicalBaselines'> = {
  performanceHistory: [], physiologicalConsent: false, previousDecisions: [],
  session: { sessionId: 'synthetic-session', startedAt: '2026-10-10T18:00:00.000Z', allowPhysiologicalPacing: false }, decisionTimestamp: timestamp,
};
const evaluations = (scores: number[]) => scores.map((score, index) => ({ score, valid: true, completedAt: `2026-10-10T18:0${index}:00.000Z` }));
const examples: Record<string, CalibrationInput> = {
  strong_answers: { ...base, currentDifficulty: 3, geminiEvaluations: evaluations([0.9, 0.9, 0.9]) },
  moderate_answers: { ...base, currentDifficulty: 3, geminiEvaluations: evaluations([0.7, 0.7, 0.7]) },
  weak_answers: { ...base, currentDifficulty: 3, geminiEvaluations: evaluations([0.3, 0.4, 0.5]) },
  no_camera: { ...base, currentDifficulty: 3, geminiEvaluations: evaluations([0.9, 0.9]), physiologicalConsent: false },
  valid_physiology_pacing: {
    ...base, currentDifficulty: 3, geminiEvaluations: evaluations([0.7, 0.7]), physiologicalConsent: true,
    session: { ...base.session, allowPhysiologicalPacing: true },
    physiological: { availability: { valid: true, measuredAt: '2026-10-10T18:59:50.000Z' }, samples: [{ metric: 'pulseRate', value: 90, confidence: 90, stable: true, measuredAt: '2026-10-10T18:59:50.000Z' }] },
    physiologicalBaselines: [{ metric: 'pulseRate', value: 60, measuredAt: '2026-10-10T18:00:00.000Z' }],
  },
};
for (const [name, input] of Object.entries(examples)) console.log(JSON.stringify({ synthetic: true, name, decision: calibrate(input) }));
