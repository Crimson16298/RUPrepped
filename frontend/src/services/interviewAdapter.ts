import { mockInterviewAdapter } from './mockInterviewAdapter'
import { createHttpInterviewAdapter } from './httpInterviewAdapter'
import type { InterviewAdapter, SessionMode } from '../types/interview'

const configuredMode = import.meta.env.VITE_INTERVIEW_MODE
export const interviewMode: SessionMode = configuredMode === 'backend' ? 'backend' : 'mock'
const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:8000'
const configuredTimeout = (value: string | undefined, fallback: number) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 1_000 ? parsed : fallback
}
const requestTimeoutMs = configuredTimeout(import.meta.env.VITE_API_TIMEOUT_MS, 30_000)
const answerTimeoutMs = configuredTimeout(import.meta.env.VITE_API_ANSWER_TIMEOUT_MS, 60_000)

export const interviewAdapter: InterviewAdapter = interviewMode === 'backend'
  ? createHttpInterviewAdapter(apiBaseUrl, { requestTimeoutMs, answerTimeoutMs })
  : mockInterviewAdapter
