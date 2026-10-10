import { useCallback, useEffect, useRef, useState } from 'react'

export type AudioPlaybackStatus = 'idle' | 'loading' | 'playing' | 'error'

export function useAudioPlayback() {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const objectUrlRef = useRef<string | null>(null)
  const [status, setStatus] = useState<AudioPlaybackStatus>('idle')
  const [error, setError] = useState<string | null>(null)

  const stop = useCallback(() => {
    audioRef.current?.pause()
    audioRef.current = null
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
    objectUrlRef.current = null
    setStatus('idle')
  }, [])

  const play = useCallback(async (audioBlob: Blob) => {
    stop()
    setError(null)
    setStatus('loading')
    const objectUrl = URL.createObjectURL(audioBlob)
    objectUrlRef.current = objectUrl
    const audio = new Audio(objectUrl)
    audioRef.current = audio
    audio.onended = () => {
      if (audioRef.current === audio) setStatus('idle')
    }
    audio.onerror = () => {
      if (audioRef.current === audio) {
        setError('The question audio could not be played. Try replaying it.')
        setStatus('error')
      }
    }
    try {
      await audio.play()
      if (audioRef.current === audio) setStatus('playing')
    } catch (cause) {
      if (audioRef.current === audio) {
        const message = cause instanceof DOMException && cause.name === 'NotAllowedError'
          ? 'Your browser blocked playback. Use Replay question to start the audio.'
          : 'The question audio could not be played. Try replaying it.'
        setError(message)
        setStatus('error')
      }
      throw cause
    }
  }, [stop])

  useEffect(() => stop, [stop])
  return { status, error, play, stop }
}
