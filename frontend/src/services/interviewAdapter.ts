import { mockInterviewAdapter } from './mockInterviewAdapter'
import { createHttpInterviewAdapter } from './httpInterviewAdapter'
import type { InterviewAdapter, SessionMode } from '../types/interview'

const configuredMode = import.meta.env.VITE_INTERVIEW_MODE
export const interviewMode: SessionMode = configuredMode === 'backend' ? 'backend' : 'mock'
const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:8000'

export const interviewAdapter: InterviewAdapter = interviewMode === 'backend'
  ? createHttpInterviewAdapter(apiBaseUrl)
  : mockInterviewAdapter
