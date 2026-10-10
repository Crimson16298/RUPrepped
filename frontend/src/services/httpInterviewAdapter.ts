import type { AnswerEvaluation, Difficulty, InterviewAdapter, Question, SessionResults, SessionSetup } from '../types/interview'

type ApiInterviewType = 'behavioral' | 'technical' | 'mixed'
interface ApiQuestion { question_id: string; question_text: string; skill_category: string; difficulty: number; interview_type: ApiInterviewType }
interface ApiErrorBody { error?: { code?: string; message?: string; fields?: Record<string, string> } }
interface CreateSessionResponse { session_id: string; status: 'created'; interview_type: ApiInterviewType; difficulty: number; question_count: number }
interface StartSessionResponse { session_id: string; status: 'in_progress'; current_question: ApiQuestion; question_number: number }
interface AnswerResponse { session_id: string; question_id: string; session_status: 'in_progress' | 'completed'; evaluation: { evaluation_source: string; is_mock: boolean; score: number; strengths: string[]; improvements: string[]; feedback: string }; next_question: ApiQuestion | null }

export class ApiRequestError extends Error {
  constructor(message: string, readonly status?: number, readonly code?: string) { super(message); this.name = 'ApiRequestError' }
}

const toDifficulty = (value: number): Difficulty => Math.max(1, Math.min(5, value)) as Difficulty
const toQuestion = (question: ApiQuestion): Question => ({ id: question.question_id, prompt: question.question_text, category: question.skill_category.replaceAll('_', ' '), estimatedMinutes: 2 })
const toEvaluation = (evaluation: AnswerResponse['evaluation']): AnswerEvaluation => ({ evaluationSource: evaluation.evaluation_source, isMock: evaluation.is_mock, score: evaluation.score, strengths: evaluation.strengths, improvements: evaluation.improvements, feedback: evaluation.feedback })
const toInterviewType = (practiceType: SessionSetup['practiceType']): ApiInterviewType => practiceType === 'job' ? 'mixed' : 'behavioral'

function requireString(value: unknown, name: string): string { if (typeof value !== 'string' || !value) throw new ApiRequestError(`Backend returned an invalid ${name}.`) ; return value }
function assertQuestion(value: unknown): asserts value is ApiQuestion { if (!value || typeof value !== 'object') throw new ApiRequestError('Backend returned an invalid question.'); const question = value as Partial<ApiQuestion>; requireString(question.question_id, 'question_id'); requireString(question.question_text, 'question_text'); requireString(question.skill_category, 'skill_category'); if (typeof question.difficulty !== 'number') throw new ApiRequestError('Backend returned an invalid question difficulty.'); }

export function createHttpInterviewAdapter(baseUrl: string): InterviewAdapter {
  const base = baseUrl.replace(/\/$/, '')
  async function request<T>(path: string, init: RequestInit): Promise<T> {
    const controller = new AbortController(); const timer = window.setTimeout(() => controller.abort(), 12_000)
    try {
      const response = await fetch(`${base}${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...init.headers }, signal: controller.signal })
      const body: unknown = await response.json().catch(() => null)
      if (!response.ok) { const apiError = body as ApiErrorBody | null; throw new ApiRequestError(apiError?.error?.message ?? `The backend returned HTTP ${response.status}.`, response.status, apiError?.error?.code) }
      return body as T
    } catch (error) {
      if (error instanceof ApiRequestError) throw error
      const message = error instanceof DOMException && error.name === 'AbortError' ? 'The backend request timed out. Check the API and try again.' : 'Unable to reach the backend. Check that FastAPI is running and try again.'
      throw new ApiRequestError(message)
    } finally { window.clearTimeout(timer) }
  }
  return {
    async createSession(setup) {
      // FastAPI accepts these fields only. Resume files remain local because the UI does not expose extracted text.
      const payload = { interview_type: toInterviewType(setup.practiceType), difficulty: setup.difficulty, question_count: 3, target_role_or_subject: setup.objective.trim() || undefined, job_description: setup.jobDescription.trim() || undefined }
      const created = await request<CreateSessionResponse>('/api/sessions', { method: 'POST', body: JSON.stringify(payload) })
      requireString(created.session_id, 'session_id')
      const started = await request<StartSessionResponse>(`/api/sessions/${encodeURIComponent(created.session_id)}/start`, { method: 'POST', body: '{}' })
      if (started.session_id !== created.session_id || started.status !== 'in_progress') throw new ApiRequestError('Backend returned an invalid session start response.')
      assertQuestion(started.current_question)
      const first = toQuestion(started.current_question)
      return { id: started.session_id, mode: 'backend', setup: { ...setup, difficulty: toDifficulty(created.difficulty) }, questionCount: created.question_count, questions: [first], answers: [], calibration: [], startedAt: new Date().toISOString(), status: 'active', transcript: [{ id: `question-${first.id}`, speaker: 'interviewer', text: first.prompt, timestamp: new Date().toISOString() }] }
    },
    async submitAnswer(session, text) {
      const current = session.questions[session.answers.length]
      if (!current) throw new ApiRequestError('There is no active backend question to answer.')
      const transcript = text.trim(); if (!transcript) throw new ApiRequestError('Enter a non-empty answer before submitting.')
      const response = await request<AnswerResponse>(`/api/sessions/${encodeURIComponent(session.id)}/answers`, { method: 'POST', body: JSON.stringify({ question_id: current.id, transcript }) })
      if (response.session_id !== session.id || response.question_id !== current.id || !response.evaluation) throw new ApiRequestError('Backend returned an invalid answer response.')
      const evaluation = toEvaluation(response.evaluation)
      const answer = { questionId: current.id, text: transcript, submittedAt: new Date().toISOString(), evaluation }
      const transcriptEvents = [...session.transcript, { id: `answer-${response.question_id}`, speaker: 'candidate' as const, text: transcript, timestamp: answer.submittedAt }]
      const questions = [...session.questions]
      if (response.next_question) { assertQuestion(response.next_question); const next = toQuestion(response.next_question); questions.push(next); transcriptEvents.push({ id: `question-${next.id}`, speaker: 'interviewer', text: next.prompt, timestamp: new Date().toISOString() }) }
      const complete = response.session_status === 'completed'
      if (complete && response.next_question !== null) throw new ApiRequestError('Backend reported completion with an unexpected next question.')
      return { session: { ...session, answers: [...session.answers, answer], questions, transcript: transcriptEvents, status: complete ? 'complete' : 'active' } }
    },
    async finishSession(session): Promise<SessionResults> {
      if (session.status !== 'complete') throw new ApiRequestError('Complete all backend questions before viewing results.')
      const evaluations = session.answers.map((answer) => { const question = session.questions.find((item) => item.id === answer.questionId); if (!question || !answer.evaluation) throw new ApiRequestError('The backend session is missing an evaluation result.'); return { question, evaluation: answer.evaluation } })
      return { mode: 'backend', sessionId: session.id, evaluations }
    },
  }
}
