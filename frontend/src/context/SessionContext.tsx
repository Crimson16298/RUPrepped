import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { interviewAdapter } from '../services/interviewAdapter'
import { ApiRequestError } from '../services/httpInterviewAdapter'
import type { InterviewSession, SessionResults, SessionSetup } from '../types/interview'

interface SessionContextValue { session: InterviewSession | null; results: SessionResults | null; busy: boolean; error: string | null; start: (setup: SessionSetup) => Promise<boolean>; answer: (text: string) => Promise<boolean>; finish: () => Promise<boolean>; reset: () => void }
const SessionContext = createContext<SessionContextValue | undefined>(undefined)
export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<InterviewSession | null>(null); const [results, setResults] = useState<SessionResults | null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null); const requestInFlight = useRef(false)
  const messageFor = (cause: unknown, fallback: string) => cause instanceof ApiRequestError ? cause.status === 409 ? `${cause.message} Refresh or retry only after confirming the current question.` : cause.message : fallback
  const value = useMemo<SessionContextValue>(() => ({ session, results, busy, error,
    async start(setup) { if (requestInFlight.current) return false; requestInFlight.current = true; setBusy(true); setError(null); try { setSession(await interviewAdapter.createSession(setup)); setResults(null); return true } catch (cause) { setError(messageFor(cause, 'Unable to start this interview. Please try again.')); return false } finally { requestInFlight.current = false; setBusy(false) } },
    async answer(text) { if (!session || requestInFlight.current) return false; requestInFlight.current = true; setBusy(true); setError(null); try { const update = await interviewAdapter.submitAnswer(session, text); setSession(update.session); return true } catch (cause) { setError(messageFor(cause, 'Your answer could not be submitted. Please try again.')); return false } finally { requestInFlight.current = false; setBusy(false) } },
    async finish() { if (!session || requestInFlight.current) return false; requestInFlight.current = true; setBusy(true); setError(null); try { setResults(await interviewAdapter.finishSession(session)); if (session.mode === 'mock') setSession({ ...session, status: 'complete' }); return true } catch (cause) { setError(messageFor(cause, 'Results could not be generated. Please try again.')); return false } finally { requestInFlight.current = false; setBusy(false) } },
    reset() { setSession(null); setResults(null); setError(null) },
  }), [session, results, busy, error])
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}
export function useSession() { const context = useContext(SessionContext); if (!context) throw new Error('useSession must be used inside SessionProvider'); return context }
