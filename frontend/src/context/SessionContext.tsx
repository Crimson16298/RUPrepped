import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { mockInterviewAdapter } from '../services/mockInterviewAdapter'
import type { InterviewSession, SessionResults, SessionSetup } from '../types/interview'

interface SessionContextValue { session: InterviewSession | null; results: SessionResults | null; busy: boolean; error: string | null; start: (setup: SessionSetup) => Promise<void>; answer: (text: string) => Promise<void>; finish: () => Promise<void>; reset: () => void }
const SessionContext = createContext<SessionContextValue | undefined>(undefined)
export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<InterviewSession | null>(null); const [results, setResults] = useState<SessionResults | null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null)
  const value = useMemo<SessionContextValue>(() => ({ session, results, busy, error,
    async start(setup) { setBusy(true); setError(null); try { setSession(await mockInterviewAdapter.createSession(setup)); setResults(null) } catch { setError('Unable to start the mock interview. Please try again.') } finally { setBusy(false) } },
    async answer(text) { if (!session) return; setBusy(true); setError(null); try { const update = await mockInterviewAdapter.submitAnswer(session, text); setSession(update.session) } catch { setError('Your simulated answer could not be submitted. Please try again.') } finally { setBusy(false) } },
    async finish() { if (!session) return; setBusy(true); try { setResults(await mockInterviewAdapter.finishSession(session)); setSession({ ...session, status: 'complete' }) } catch { setError('Results could not be generated in mock mode.') } finally { setBusy(false) } },
    reset() { setSession(null); setResults(null); setError(null) },
  }), [session, results, busy, error])
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}
export function useSession() { const context = useContext(SessionContext); if (!context) throw new Error('useSession must be used inside SessionProvider'); return context }
