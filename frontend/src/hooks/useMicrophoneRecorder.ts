import { useCallback, useEffect, useRef, useState } from 'react'

export type RecordingStatus = 'idle' | 'requesting-permission' | 'recording' | 'error'

const preferredMimeTypes = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus']

function preferredMimeType(): string | undefined {
  return preferredMimeTypes.find((mimeType) => MediaRecorder.isTypeSupported(mimeType))
}

function stopTracks(stream: MediaStream) {
  stream.getTracks().forEach((track) => track.stop())
}

export function useMicrophoneRecorder() {
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<BlobPart[]>([])
  const startInFlightRef = useRef(false)
  const stopInFlightRef = useRef<Promise<Blob> | null>(null)
  const permissionRequestVersionRef = useRef(0)
  const mountedRef = useRef(true)
  const [status, setStatus] = useState<RecordingStatus>('idle')
  const [error, setError] = useState<string | null>(null)

  const setStatusIfMounted = useCallback((nextStatus: RecordingStatus) => {
    if (mountedRef.current) setStatus(nextStatus)
  }, [])

  const setErrorIfMounted = useCallback((message: string | null) => {
    if (mountedRef.current) setError(message)
  }, [])

  const releaseStream = useCallback(() => {
    const stream = streamRef.current
    streamRef.current = null
    if (stream) stopTracks(stream)
  }, [])

  const invalidatePendingPermission = useCallback(() => {
    permissionRequestVersionRef.current += 1
    startInFlightRef.current = false
  }, [])

  const start = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      const message = 'This browser does not support microphone recording.'
      setErrorIfMounted(message)
      setStatusIfMounted('error')
      throw new Error(message)
    }

    // Set before the first await so rapid clicks cannot open parallel prompts/streams.
    if (startInFlightRef.current || recorderRef.current || streamRef.current) return

    startInFlightRef.current = true
    const requestVersion = permissionRequestVersionRef.current + 1
    permissionRequestVersionRef.current = requestVersion
    setErrorIfMounted(null)
    setStatusIfMounted('requesting-permission')

    let receivedStream: MediaStream | null = null
    let createdRecorder: MediaRecorder | null = null
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      receivedStream = stream
      const requestIsCurrent = mountedRef.current
        && startInFlightRef.current
        && permissionRequestVersionRef.current === requestVersion
        && !recorderRef.current
        && !streamRef.current

      // Permission may resolve after cancellation or unmounting. Do not retain it.
      if (!requestIsCurrent) {
        stopTracks(stream)
        return
      }

      streamRef.current = stream
      const mimeType = preferredMimeType()
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      createdRecorder = recorder
      chunksRef.current = []
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data)
      }
      recorder.onerror = () => {
        if (recorderRef.current !== recorder) return
        const message = 'Recording stopped unexpectedly. Please try again.'
        recorderRef.current = null
        releaseStream()
        setErrorIfMounted(message)
        setStatusIfMounted('error')
      }
      recorderRef.current = recorder
      recorder.start()
      setStatusIfMounted('recording')
    } catch (cause) {
      if (permissionRequestVersionRef.current !== requestVersion || !mountedRef.current) return

      if (recorderRef.current === createdRecorder) recorderRef.current = null
      if (streamRef.current === receivedStream) releaseStream()
      else if (receivedStream) stopTracks(receivedStream)
      const message = cause instanceof DOMException && cause.name === 'NotAllowedError'
        ? 'Microphone access was denied. Allow it in your browser settings and try again.'
        : 'Unable to start the microphone. Check your audio input and try again.'
      setErrorIfMounted(message)
      setStatusIfMounted('error')
      throw new Error(message, { cause })
    } finally {
      if (permissionRequestVersionRef.current === requestVersion) {
        startInFlightRef.current = false
      }
    }
  }, [releaseStream, setErrorIfMounted, setStatusIfMounted])

  const stop = useCallback((): Promise<Blob> => {
    // Repeated Stop clicks share the original operation rather than re-stopping it.
    if (stopInFlightRef.current) return stopInFlightRef.current

    const recorder = recorderRef.current
    if (!recorder || recorder.state !== 'recording') {
      if (startInFlightRef.current) {
        invalidatePendingPermission()
        setStatusIfMounted('idle')
      }
      return Promise.reject(new Error('No microphone recording is in progress.'))
    }

    const stopPromise = new Promise<Blob>((resolve, reject) => {
      recorder.onerror = null
      recorder.onstop = () => {
        if (recorderRef.current !== recorder) return

        const recording = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
        recorderRef.current = null
        releaseStream()
        stopInFlightRef.current = null
        if (!recording.size) {
          const message = 'No audio was captured. Please record your answer again.'
          setErrorIfMounted(message)
          setStatusIfMounted('error')
          reject(new Error(message))
          return
        }
        setStatusIfMounted('idle')
        resolve(recording)
      }

      try {
        recorder.stop()
      } catch (cause) {
        stopInFlightRef.current = null
        const message = 'Unable to stop the microphone recording. Please try again.'
        setErrorIfMounted(message)
        setStatusIfMounted('error')
        reject(new Error(message, { cause }))
      }
    })
    stopInFlightRef.current = stopPromise
    return stopPromise
  }, [invalidatePendingPermission, releaseStream, setErrorIfMounted, setStatusIfMounted])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      invalidatePendingPermission()
      stopInFlightRef.current = null

      const recorder = recorderRef.current
      recorderRef.current = null
      if (recorder && recorder.state !== 'inactive') {
        recorder.onstop = null
        recorder.onerror = null
        try {
          recorder.stop()
        } catch {
          // The recorder is already stopping; its stream is released below.
        }
      }
      releaseStream()
    }
  }, [invalidatePendingPermission, releaseStream])

  return { status, error, start, stop }
}
