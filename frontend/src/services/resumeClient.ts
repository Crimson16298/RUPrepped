import { ApiRequestError } from './httpInterviewAdapter'

interface ApiErrorDetail { code?: string; message?: string }
interface ApiErrorBody { error?: ApiErrorDetail; detail?: ApiErrorDetail }
interface ResumeExtractionResponse { filename?: unknown; resume_text?: unknown }

export interface ExtractedResume { filename: string; resumeText: string }

export async function extractResume(baseUrl: string, file: File, signal?: AbortSignal): Promise<ExtractedResume> {
  const body = new FormData()
  body.append('file', file)
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/resumes/extract`, { method: 'POST', body, signal })
    const payload = await response.json().catch(() => null) as ResumeExtractionResponse & ApiErrorBody | null
    if (!response.ok) {
      const detail = payload?.error ?? payload?.detail
      throw new ApiRequestError(detail?.message ?? `The resume service returned HTTP ${response.status}.`, response.status, detail?.code)
    }
    if (typeof payload?.filename !== 'string' || !payload.filename || typeof payload.resume_text !== 'string' || !payload.resume_text.trim()) {
      throw new ApiRequestError('The resume service returned an invalid extraction response.')
    }
    return { filename: payload.filename, resumeText: payload.resume_text }
  } catch (error) {
    if (error instanceof ApiRequestError) throw error
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new ApiRequestError('Unable to reach the resume service. Check that FastAPI is running and try again.')
  }
}
