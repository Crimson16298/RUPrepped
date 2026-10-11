import type {
  AnswerEvaluation,
  CalibrationEvent,
  Difficulty,
  InterviewAdapter,
  ProviderMode,
  Question,
  RubricScores,
  SessionResults,
  SessionSetup,
} from '../types/interview'

type ApiInterviewType = 'behavioral' | 'technical' | 'mixed'
type ApiProviderMode = 'mock' | 'gemini'

interface ApiQuestion { question_id: string; question_text: string; skill_category: string; difficulty: number; interview_type: ApiInterviewType }
interface ApiRubricScores { relevance: number; completeness: number; clarity: number; reasoning: number; technical_correctness: number | null; concrete_details: number }
interface ApiDifficultyAdjustment { previous_difficulty: number; next_difficulty: number; decision: 'increase' | 'maintain' | 'decrease'; rationale: string; source: 'evaluation' }
interface ApiEvaluation { evaluation_source: 'mock_deterministic' | 'gemini'; is_mock: boolean; score: number; rubric: ApiRubricScores; strengths: string[]; improvements: string[]; feedback: string }
interface ApiErrorDetail { code?: string; message?: string; fields?: Record<string, string> }
interface ApiErrorBody { error?: ApiErrorDetail; /** FastAPI HTTPException currently returns this shape. */ detail?: ApiErrorDetail }
interface CreateSessionResponse { session_id: string; status: 'created'; interview_type: ApiInterviewType; difficulty: number; question_count: number; provider_mode: ApiProviderMode }
interface StartSessionResponse extends Omit<CreateSessionResponse, 'status'> { status: 'in_progress'; current_question: ApiQuestion; question_number: number }
interface AnswerResponse { session_id: string; question_id: string; answer_id: string; status: 'accepted'; session_status: 'in_progress' | 'completed'; evaluation: ApiEvaluation; difficulty_adjustment: ApiDifficultyAdjustment; next_question: ApiQuestion | null }

export class ApiRequestError extends Error {
  constructor(message: string, readonly status?: number, readonly code?: string) { super(message); this.name = 'ApiRequestError' }
}

export interface HttpInterviewAdapterOptions { requestTimeoutMs?: number; answerTimeoutMs?: number }

const toDifficulty = (value: number): Difficulty => Math.max(1, Math.min(5, value)) as Difficulty
const toProviderMode = (value: ApiProviderMode): ProviderMode => value
const toQuestion = (question: ApiQuestion): Question => ({ id: question.question_id, prompt: question.question_text, category: question.skill_category.replaceAll('_', ' '), estimatedMinutes: 2, difficulty: toDifficulty(question.difficulty) })
const toRubric = (rubric: ApiRubricScores): RubricScores => ({ relevance: rubric.relevance, completeness: rubric.completeness, clarity: rubric.clarity, reasoning: rubric.reasoning, technicalCorrectness: rubric.technical_correctness, concreteDetails: rubric.concrete_details })
const toEvaluation = (evaluation: ApiEvaluation): AnswerEvaluation => ({ evaluationSource: evaluation.evaluation_source, isMock: evaluation.is_mock, score: evaluation.score, rubric: toRubric(evaluation.rubric), strengths: evaluation.strengths, improvements: evaluation.improvements, feedback: evaluation.feedback })
const toCalibration = (adjustment: ApiDifficultyAdjustment, questionId: string): CalibrationEvent => ({ questionId, previousLevel: toDifficulty(adjustment.previous_difficulty), nextLevel: toDifficulty(adjustment.next_difficulty), decision: adjustment.decision, rationale: adjustment.rationale, source: adjustment.source })
const toInterviewType = (practiceType: SessionSetup['practiceType']): ApiInterviewType => practiceType === 'job' ? 'mixed' : 'behavioral'

function requireString(value: unknown, name: string): string { if (typeof value !== 'string' || !value) throw new ApiRequestError(`Backend returned an invalid ${name}.`); return value }
function assertQuestion(value: unknown): asserts value is ApiQuestion { if (!value || typeof value !== 'object') throw new ApiRequestError('Backend returned an invalid question.'); const question = value as Partial<ApiQuestion>; requireString(question.question_id, 'question_id'); requireString(question.question_text, 'question_text'); requireString(question.skill_category, 'skill_category'); if (typeof question.difficulty !== 'number') throw new ApiRequestError('Backend returned an invalid question difficulty.') }
const usableTimeout = (value: number | undefined, fallback: number) => typeof value === 'number' && Number.isFinite(value) && value >= 1_000 ? value : fallback
const errorMessageFor = (status: number, fallback: string) => {
  if (status === 502) return 'The interview provider returned an invalid response. The request was not completed; please retry shortly.'
  if (status === 503) return 'The interview provider is temporarily unavailable. Please retry in a moment.'
  if (status === 504) return 'The interview provider took too long to respond. We could not confirm this answer was accepted; verify the current question before retrying.'
  return fallback
}

export function createHttpInterviewAdapter(baseUrl: string, options: HttpInterviewAdapterOptions = {}): InterviewAdapter {
  const base = baseUrl.replace(/\/$/, '')
  const requestTimeoutMs = usableTimeout(options.requestTimeoutMs, 30_000)
  const answerTimeoutMs = usableTimeout(options.answerTimeoutMs, 60_000)
  async function request<T>(path: string, init: RequestInit, timeoutMs = requestTimeoutMs): Promise<T> {
    const controller = new AbortController(); const timer = window.setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(`${base}${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...init.headers }, signal: controller.signal })
      const body: unknown = await response.json().catch(() => null)
      if (!response.ok) {
        const errorBody = body as ApiErrorBody | null; const apiError = errorBody?.error ?? errorBody?.detail
        throw new ApiRequestError(errorMessageFor(response.status, apiError?.message ?? `The backend returned HTTP ${response.status}.`), response.status, apiError?.code)
      }
      return body as T
    } catch (error) {
      if (error instanceof ApiRequestError) throw error
      const message = error instanceof DOMException && error.name === 'AbortError' ? 'The request timed out before a response was received. We could not confirm the request completed; verify the current question before retrying.' : 'Unable to reach the backend. Check that FastAPI is running and try again.'
      throw new ApiRequestError(message)
    } finally { window.clearTimeout(timer) }
  }
  return {
    async createSession(setup) {
      const payload = { interview_type: toInterviewType(setup.practiceType), difficulty: setup.difficulty, question_count: 3, target_role_or_subject: setup.objective.trim() || undefined, job_description: setup.jobDescription.trim() || undefined, resume_text: setup.resumeText?.trim() || undefined }
      const created = await request<CreateSessionResponse>('/api/sessions', { method: 'POST', body: JSON.stringify(payload) })
      requireString(created.session_id, 'session_id')
      const started = await request<StartSessionResponse>(`/api/sessions/${encodeURIComponent(created.session_id)}/start`, { method: 'POST', body: '{}' })
      if (started.session_id !== created.session_id || started.status !== 'in_progress') throw new ApiRequestError('Backend returned an invalid session start response.')
      if (started.provider_mode !== created.provider_mode) throw new ApiRequestError('Backend returned inconsistent provider information for this session.')
      assertQuestion(started.current_question)
      const first = toQuestion(started.current_question)
      return { id: started.session_id, mode: 'backend', providerMode: toProviderMode(created.provider_mode), setup: { ...setup, difficulty: toDifficulty(created.difficulty) }, questionCount: created.question_count, questions: [first], answers: [], calibration: [], startedAt: new Date().toISOString(), status: 'active', transcript: [{ id: `question-${first.id}`, speaker: 'interviewer', text: first.prompt, timestamp: new Date().toISOString() }] }
    },
    async submitAnswer(session, text) {
      const current = session.questions[session.answers.length]
      if (!current) throw new ApiRequestError('There is no active backend question to answer.')
      const transcript = text.trim(); if (!transcript) throw new ApiRequestError('Enter a non-empty answer before submitting.')
      const response = await request<AnswerResponse>(`/api/sessions/${encodeURIComponent(session.id)}/answers`, { method: 'POST', body: JSON.stringify({ question_id: current.id, transcript }) }, answerTimeoutMs)
      if (response.session_id !== session.id || response.question_id !== current.id || response.status !== 'accepted') throw new ApiRequestError('Backend returned an invalid answer response.')
      requireString(response.answer_id, 'answer_id')
      const evaluation = toEvaluation(response.evaluation); const calibration = toCalibration(response.difficulty_adjustment, current.id)
      const answer = { id: response.answer_id, questionId: current.id, text: transcript, submittedAt: new Date().toISOString(), evaluation }
      const transcriptEvents = [...session.transcript, { id: `answer-${response.answer_id}`, speaker: 'candidate' as const, text: transcript, timestamp: answer.submittedAt }]
      const questions = [...session.questions]
      if (response.next_question) { assertQuestion(response.next_question); const next = toQuestion(response.next_question); questions.push(next); transcriptEvents.push({ id: `question-${next.id}`, speaker: 'interviewer', text: next.prompt, timestamp: new Date().toISOString() }) }
      const complete = response.session_status === 'completed'
      if (complete !== (response.next_question === null)) throw new ApiRequestError('Backend returned an inconsistent completion response.')
      return { session: { ...session, answers: [...session.answers, answer], questions, calibration: [...session.calibration, calibration], transcript: transcriptEvents, status: complete ? 'complete' : 'active' }, calibration }
    },
    async finishSession(session): Promise<SessionResults> {
      if (session.status !== 'complete') throw new ApiRequestError('Complete all backend questions before viewing results.')
      const evaluations = session.answers.map((answer) => { const question = session.questions.find((item) => item.id === answer.questionId); if (!question || !answer.evaluation) throw new ApiRequestError('The backend session is missing an evaluation result.'); return { question, evaluation: answer.evaluation } })
      return { mode: 'backend', sessionId: session.id, providerMode: session.providerMode, evaluations }
    },
  }
}
