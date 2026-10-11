export type PracticeType = 'job' | 'oral-exam' | 'presentation' | 'social'
export type Difficulty = 1 | 2 | 3 | 4 | 5
export type SessionMode = 'mock' | 'backend'
export type ProviderMode = 'mock' | 'gemini'
export type VoiceStatus = 'unavailable' | 'idle' | 'speaking' | 'listening'
export type SignalAvailability = 'not-requested' | 'permission-denied' | 'unavailable' | 'available'

export interface SessionSetup { practiceType: PracticeType; objective: string; jobDescription: string; resumeText?: string; difficulty: Difficulty; lengthMinutes: number; cameraEnabled: boolean }
export interface Question {
  id: string
  prompt: string
  category: string
  estimatedMinutes: number
  /** Optional because mock banks and older API responses may not provide it. */
  difficulty?: Difficulty
}
export interface RubricScores {
  relevance: number
  completeness: number
  clarity: number
  reasoning: number
  technicalCorrectness: number | null
  concreteDetails: number
}
export interface AnswerEvaluation { evaluationSource: 'mock_deterministic' | 'gemini'; isMock: boolean; score: number; rubric: RubricScores; strengths: string[]; improvements: string[]; feedback: string }
export interface Answer { id?: string; questionId: string; text: string; submittedAt: string; evaluation?: AnswerEvaluation }
export interface TranscriptEvent { id: string; speaker: 'interviewer' | 'candidate'; text: string; timestamp: string }
export interface CalibrationEvent { questionId: string; previousLevel: Difficulty; nextLevel: Difficulty; decision: 'increase' | 'decrease' | 'maintain'; rationale: string; source: 'mock' | 'evaluation' | 'sensor-context' }
export interface QuestionFeedback { questionId: string; question: string; score: number; note: string }
export interface MockSessionResults { mode: 'mock'; overallScore: number; contentScore: number; deliveryScore: number; strengths: string[]; opportunities: string[]; followUps: string[]; questionFeedback: QuestionFeedback[] }
export interface BackendSessionResults { mode: 'backend'; sessionId: string; providerMode: ProviderMode; evaluations: Array<{ question: Question; evaluation: AnswerEvaluation }> }
export type SessionResults = MockSessionResults | BackendSessionResults
export interface InterviewSession { id: string; mode: SessionMode; providerMode: ProviderMode; setup: SessionSetup; questionCount: number; questions: Question[]; answers: Answer[]; transcript: TranscriptEvent[]; calibration: CalibrationEvent[]; startedAt: string; status: 'active' | 'complete' }

// Provisional frontend integration contracts. Person 1 owns the finalized shared API contract.
export interface InterviewAdapter { createSession(setup: SessionSetup): Promise<InterviewSession>; submitAnswer(session: InterviewSession, text: string): Promise<{ session: InterviewSession; calibration?: CalibrationEvent }>; finishSession(session: InterviewSession): Promise<SessionResults> }
export interface VoiceTransport { status: VoiceStatus; onTranscript?: (event: TranscriptEvent) => void }
export interface CalibrationTransport { signalAvailability: SignalAvailability; onCalibration?: (event: CalibrationEvent) => void }
