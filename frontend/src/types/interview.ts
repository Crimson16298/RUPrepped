export type PracticeType = 'job' | 'oral-exam' | 'presentation' | 'social'
export type Difficulty = 1 | 2 | 3 | 4 | 5
export type VoiceStatus = 'unavailable' | 'idle' | 'speaking' | 'listening'
export type SignalAvailability = 'not-requested' | 'permission-denied' | 'unavailable' | 'available'

export interface SessionSetup { practiceType: PracticeType; objective: string; jobDescription: string; difficulty: Difficulty; lengthMinutes: number; cameraEnabled: boolean }
export interface Question { id: string; prompt: string; category: string; estimatedMinutes: number }
export interface Answer { questionId: string; text: string; submittedAt: string }
export interface TranscriptEvent { id: string; speaker: 'interviewer' | 'candidate'; text: string; timestamp: string }
export interface CalibrationEvent { questionId: string; previousLevel: Difficulty; nextLevel: Difficulty; decision: 'increase' | 'decrease' | 'maintain'; rationale: string; source: 'mock' | 'evaluation' | 'sensor-context' }
export interface QuestionFeedback { questionId: string; question: string; score: number; note: string }
export interface SessionResults { overallScore: number; contentScore: number; deliveryScore: number; strengths: string[]; opportunities: string[]; followUps: string[]; questionFeedback: QuestionFeedback[] }
export interface InterviewSession { id: string; setup: SessionSetup; questions: Question[]; answers: Answer[]; transcript: TranscriptEvent[]; calibration: CalibrationEvent[]; startedAt: string; status: 'active' | 'complete' }

// Provisional frontend integration contracts. Person 1 owns the finalized shared API contract.
export interface InterviewAdapter { createSession(setup: SessionSetup): Promise<InterviewSession>; submitAnswer(session: InterviewSession, text: string): Promise<{ session: InterviewSession; calibration?: CalibrationEvent }>; finishSession(session: InterviewSession): Promise<SessionResults> }
export interface VoiceTransport { status: VoiceStatus; onTranscript?: (event: TranscriptEvent) => void }
export interface CalibrationTransport { signalAvailability: SignalAvailability; onCalibration?: (event: CalibrationEvent) => void }
