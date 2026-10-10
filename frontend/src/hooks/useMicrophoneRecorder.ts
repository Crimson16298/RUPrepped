import { useCallback, useEffect, useRef, useState } from 'react'

export type RecordingStatus = 'idle' | 'requesting-permission' | 'recording' | 'error'

const preferredMimeTypes = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus']

function preferredMimeType(): string | undefined {
  return preferredMimeTypes.find((mimeType) => MediaRecorder.isTypeSupported(mimeType))
}

export function useMicrophoneRecorder() {
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<BlobPart[]>([])
  const [status, setStatus] = useState<RecordingStatus>('idle')
  const [error, setError] = useState<string | null>(null)

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }, [])

  const start = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      const message = 'This browser does not support microphone recording.'
      setError(message)
      setStatus('error')
      throw new Error(message)
    }
    if (recorderRef.current?.state === 'recording') return

    setError(null)
    setStatus('requesting-permission')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const mimeType = preferredMimeType()
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      chunksRef.current = []
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data)
      }
      recorder.onerror = () => {
        const message = 'Recording stopped unexpectedly. Please try again.'
        setError(message)
        setStatus('error')
        releaseStream()
      }
      recorderRef.current = recorder
      recorder.start()
      setStatus('recording')
    } catch (cause) {
      releaseStream()
      const message = cause instanceof DOMException && cause.name === 'NotAllowedError'
        ? 'Microphone access was denied. Allow it in your browser settings and try again.'
        : 'Unable to start the microphone. Check your audio input and try again.'
      setError(message)
      setStatus('error')
      throw new Error(message, { cause })
    }
  }, [releaseStream])

  const stop = useCallback((): Promise<Blob> => {
    const recorder = recorderRef.current
    if (!recorder || recorder.state !== 'recording') {
      return Promise.reject(new Error('No microphone recording is in progress.'))
    }
    return new Promise((resolve, reject) => {
      recorder.onstop = () => {
        const recording = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
        recorderRef.current = null
        releaseStream()
        if (!recording.size) {
          const message = 'No audio was captured. Please record your answer again.'
          setError(message)
          setStatus('error')
          reject(new Error(message))
          return
        }
        setStatus('idle')
        resolve(recording)
      }
      recorder.stop()
    })
  }, [releaseStream])

  useEffect(() => () => {
    recorderRef.current?.stop()
    releaseStream()
  }, [releaseStream])

  return { status, error, start, stop }
}
