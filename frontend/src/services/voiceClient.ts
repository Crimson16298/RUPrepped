export class VoiceRequestError extends Error {
  constructor(message: string, readonly status?: number, readonly code?: string) {
    super(message)
    this.name = 'VoiceRequestError'
  }
}

type ApiErrorDetail = { code?: string; message?: string }
type ApiErrorBody = { error?: ApiErrorDetail; detail?: ApiErrorDetail }

async function errorFrom(response: Response): Promise<VoiceRequestError> {
  const body = await response.json().catch(() => null) as ApiErrorBody | null
  const detail = body?.error ?? body?.detail
  return new VoiceRequestError(
    detail?.message ?? `The voice service returned HTTP ${response.status}.`,
    response.status,
    detail?.code,
  )
}

export function isVoiceRequestAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

export async function fetchQuestionAudio(baseUrl: string, text: string, signal?: AbortSignal): Promise<Blob> {
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/voice/synthesize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal,
    })
    if (!response.ok) throw await errorFrom(response)
    return response.blob()
  } catch (error) {
    if (error instanceof VoiceRequestError) throw error
    if (isVoiceRequestAbort(error)) throw error
    throw new VoiceRequestError('Unable to reach the voice service. Check that FastAPI is running and try again.')
  }
}

function extensionFor(mimeType: string): string {
  if (mimeType.includes('mp4')) return 'm4a'
  if (mimeType.includes('ogg')) return 'ogg'
  if (mimeType.includes('wav')) return 'wav'
  return 'webm'
}

export async function transcribeRecording(baseUrl: string, recording: Blob, signal?: AbortSignal): Promise<string> {
  const body = new FormData()
  body.append('file', recording, `answer.${extensionFor(recording.type)}`)
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/voice/transcribe`, {
      method: 'POST',
      body,
      signal,
    })
    if (!response.ok) throw await errorFrom(response)
    const payload = await response.json() as { transcript?: unknown }
    if (typeof payload.transcript !== 'string' || !payload.transcript.trim()) {
      throw new VoiceRequestError('The voice service returned an invalid transcript.')
    }
    return payload.transcript.trim()
  } catch (error) {
    if (error instanceof VoiceRequestError) throw error
    if (isVoiceRequestAbort(error)) throw error
    throw new VoiceRequestError('Unable to transcribe the recording. Check the voice service and try again.')
  }
}
