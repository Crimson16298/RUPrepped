import { mockQuestions, mockResults } from '../mocks/interviewData'
import type { CalibrationEvent, InterviewAdapter, InterviewSession, SessionResults, SessionSetup } from '../types/interview'

const now = () => new Date().toISOString()
const level = (value: number) => Math.min(5, Math.max(1, value)) as 1 | 2 | 3 | 4 | 5

export const mockInterviewAdapter: InterviewAdapter = {
  async createSession(setup: SessionSetup): Promise<InterviewSession> {
    const first = mockQuestions[0]
    return { id: `demo-${Date.now()}`, mode: 'mock', providerMode: 'mock', setup, questionCount: mockQuestions.length, questions: mockQuestions, answers: [], calibration: [], startedAt: now(), status: 'active', transcript: [{ id: 'intro', speaker: 'interviewer', text: first.prompt, timestamp: now() }] }
  },
  async submitAnswer(session, text) {
    const current = session.questions[session.answers.length]
    const answer = { questionId: current.id, text, submittedAt: now() }
    const nextIndex = session.answers.length + 1
    const isStrongMockAnswer = text.trim().split(/\s+/).length >= 18
    const nextLevel = level(session.setup.difficulty + (isStrongMockAnswer ? 1 : 0))
    const calibration: CalibrationEvent = { questionId: current.id, previousLevel: session.setup.difficulty, nextLevel, decision: nextLevel > session.setup.difficulty ? 'increase' : 'maintain', rationale: isStrongMockAnswer ? 'Mock text response included enough detail to raise the next prompt slightly.' : 'Mock mode kept the next prompt at the current level while you build your answer.', source: 'mock' }
    const nextQuestion = session.questions[nextIndex]
    const transcript = [...session.transcript, { id: `a-${nextIndex}`, speaker: 'candidate' as const, text, timestamp: answer.submittedAt }]
    if (nextQuestion) transcript.push({ id: `q-${nextIndex}`, speaker: 'interviewer', text: nextQuestion.prompt, timestamp: now() })
    return { session: { ...session, answers: [...session.answers, answer], calibration: [...session.calibration, calibration], transcript, setup: { ...session.setup, difficulty: nextLevel } }, calibration }
  },
  async finishSession(session): Promise<SessionResults> { return mockResults(session.questions.slice(0, Math.max(1, session.answers.length))) },
}
