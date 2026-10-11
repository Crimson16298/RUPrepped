import {
  Bot,
  CheckCircle2,
  Clock3,
  Coffee,
  FastForward,
  Mic,
  MicOff,
  Pause,
  Send,
  Sparkles,
  Square,
  TriangleAlert,
  Volume2,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppShell, Stepper } from "../components/AppShell";
import { Badge, Button, Card } from "../components/ui";
import { useSession } from "../context/SessionContext";
import { useAudioPlayback } from "../hooks/useAudioPlayback";
import { useMicrophoneRecorder } from "../hooks/useMicrophoneRecorder";
import { fetchQuestionAudio, isVoiceRequestAbort, transcribeRecording, VoiceRequestError } from "../services/voiceClient";

function elapsed(startedAt: string) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export function LiveInterviewPage() {
  const navigate = useNavigate();
  const { session, answer, finish, busy, error } = useSession();
  const [text, setText] = useState("");
  const [time, setTime] = useState("00:00");
  const [paused, setPaused] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [transcribing, setTranscribing] = useState(false);
  const [audioLoading, setAudioLoading] = useState(false);
  const spokenQuestionRef = useRef<string | null>(null);
  const submittingRef = useRef(false);
  const audioRequestVersionRef = useRef(0);
  const audioRequestControllerRef = useRef<AbortController | null>(null);
  const transcriptionVersionRef = useRef(0);
  const transcriptionControllerRef = useRef<AbortController | null>(null);
  const recordingQuestionIdRef = useRef<string | null>(null);
  const activeQuestionIdRef = useRef<string | null>(null);
  const { status: playbackStatus, error: playbackError, play, stop: stopPlayback } = useAudioPlayback();
  const { status: recorderStatus, error: recorderError, start: startMicrophone, stop: stopMicrophone } = useMicrophoneRecorder();
  const voiceBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000";

  useEffect(() => {
    if (!session || paused) return;
    const tick = () => setTime(elapsed(session.startedAt));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [session, paused]);

  const index = session?.answers.length ?? 0;
  const current = session?.questions[index];
  activeQuestionIdRef.current = current?.id ?? null;
  const done = !current;
  const isBackend = session?.mode === "backend";
  const latestCalibration = session?.calibration.at(-1);
  const displayedDifficulty = isBackend ? current?.difficulty ?? session?.setup.difficulty : latestCalibration?.nextLevel ?? session?.setup.difficulty;
  const progress = session ? Math.round((index / session.questionCount) * 100) : 0;
  const providerLabel = !session
    ? "Interview not started"
    : session.mode === "backend"
      ? session.providerMode === "gemini" ? "Gemini interview in progress" : "Backend mock interview in progress"
      : "Mock interview in progress";
  const sessionState = busy
    ? "Saving answer…"
    : transcribing
      ? "Transcribing answer…"
      : audioLoading
        ? "Loading question…"
      : playbackStatus === "playing"
        ? "Question playing"
        : recorderStatus === "recording" ? "Recording answer" : "Ready";
  const adjustmentTitle = latestCalibration?.decision === "increase"
    ? "Slightly harder next"
    : latestCalibration?.decision === "decrease" ? "Slightly easier next" : "Holding steady";

  const cancelQuestionAudio = useCallback(() => {
    audioRequestVersionRef.current += 1;
    audioRequestControllerRef.current?.abort();
    audioRequestControllerRef.current = null;
    stopPlayback();
    setAudioLoading(false);
  }, [stopPlayback]);

  const cancelTranscription = useCallback(() => {
    transcriptionVersionRef.current += 1;
    transcriptionControllerRef.current?.abort();
    transcriptionControllerRef.current = null;
    setTranscribing(false);
  }, []);

  const playCurrentQuestion = useCallback(async () => {
    if (!isBackend || !current || paused) return;
    if (recorderStatus === "recording") {
      setVoiceError("Stop recording before playing the question again.");
      return;
    }
    if (transcribing) {
      setVoiceError("Wait for transcription to finish before replaying the question.");
      return;
    }

    cancelQuestionAudio();
    const version = audioRequestVersionRef.current + 1;
    audioRequestVersionRef.current = version;
    const controller = new AbortController();
    audioRequestControllerRef.current = controller;
    setVoiceError(null);
    setAudioLoading(true);
    try {
      const audio = await fetchQuestionAudio(voiceBaseUrl, current.prompt, controller.signal);
      if (audioRequestVersionRef.current !== version || activeQuestionIdRef.current !== current.id || paused) return;
      await play(audio);
    } catch (cause) {
      if (audioRequestVersionRef.current !== version || isVoiceRequestAbort(cause)) return;
      if (cause instanceof VoiceRequestError) setVoiceError(cause.message);
      else if (!playbackError) setVoiceError("The question audio could not be played. Try replaying it.");
    } finally {
      if (audioRequestVersionRef.current === version) {
        audioRequestControllerRef.current = null;
        setAudioLoading(false);
      }
    }
  }, [cancelQuestionAudio, current, isBackend, paused, play, playbackError, recorderStatus, transcribing, voiceBaseUrl]);

  useEffect(() => {
    if (!isBackend || !current || paused) {
      cancelQuestionAudio();
      return;
    }
    if (spokenQuestionRef.current === current.id) return;
    spokenQuestionRef.current = current.id;
    void playCurrentQuestion();
  }, [cancelQuestionAudio, current, isBackend, paused, playCurrentQuestion]);

  useEffect(() => {
    cancelTranscription();
  }, [cancelTranscription, current?.id]);

  useEffect(() => () => {
    audioRequestVersionRef.current += 1;
    audioRequestControllerRef.current?.abort();
    transcriptionVersionRef.current += 1;
    transcriptionControllerRef.current?.abort();
    spokenQuestionRef.current = null;
    stopPlayback();
  }, [stopPlayback]);

  async function startRecording() {
    if (!current) return;
    cancelQuestionAudio();
    recordingQuestionIdRef.current = current.id;
    setVoiceError(null);
    try {
      await startMicrophone();
    } catch (cause) {
      setVoiceError(cause instanceof Error ? cause.message : "Unable to start microphone recording.");
    }
  }

  async function stopRecordingAndTranscribe() {
    const recordedQuestionId = recordingQuestionIdRef.current;
    let transcriptionVersion: number | null = null;
    setVoiceError(null);
    try {
      const recording = await stopMicrophone();
      recordingQuestionIdRef.current = null;
      if (!recordedQuestionId) throw new Error("The recording is not associated with an active question. Please record it again.");
      transcriptionVersion = transcriptionVersionRef.current + 1;
      transcriptionVersionRef.current = transcriptionVersion;
      const controller = new AbortController();
      transcriptionControllerRef.current = controller;
      setTranscribing(true);
      const transcript = await transcribeRecording(voiceBaseUrl, recording, controller.signal);
      if (transcriptionVersionRef.current !== transcriptionVersion || activeQuestionIdRef.current !== recordedQuestionId) {
        setVoiceError("The question changed while transcription was in progress. Please record your answer again.");
        return;
      }
      setText(transcript);
    } catch (cause) {
      if (!isVoiceRequestAbort(cause)) setVoiceError(cause instanceof Error ? cause.message : "Unable to transcribe the recording.");
    } finally {
      recordingQuestionIdRef.current = null;
      if (transcriptionVersion === null || transcriptionVersionRef.current === transcriptionVersion) setTranscribing(false);
    }
  }

  async function submit() {
    if (!text.trim() || done || submittingRef.current || recorderStatus === "recording" || transcribing) return;
    submittingRef.current = true;
    try {
      cancelQuestionAudio();
      if (await answer(text)) setText("");
    } finally {
      submittingRef.current = false;
    }
  }

  async function complete() {
    if (await finish()) navigate("/results");
  }

  function togglePause() {
    if (recorderStatus === "recording") {
      setVoiceError("Stop and transcribe your recording before pausing the interview.");
      return;
    }
    if (!paused) cancelQuestionAudio();
    setPaused((value) => !value);
  }

  if (!session) {
    return <AppShell><main className="empty-state"><TriangleAlert /><h1>No active practice session</h1><p>Set up a mock interview before entering the room.</p><Button onClick={() => navigate("/setup")}>Go to setup</Button></main></AppShell>;
  }

  return (
    <AppShell>
      <main className="page-wrap interview-page">
        <Stepper current={2} />
        <div className="interview-meta">
          <div><Badge>{providerLabel}</Badge><span>{session.setup.objective}</span></div>
          <div><Clock3 size={17} /><strong>{time}</strong><span>Simulated timer</span></div>
          <span className="session-state" aria-live="polite">{sessionState}</span>
        </div>
        <div className="interview-grid">
          <section className="interview-main">
            <Card className="interviewer-card">
              <div className="interviewer-top">
                <div className="interviewer-avatar"><Bot size={34} /></div>
                <div>
                  <span className="speaking-pill"><i /> {playbackStatus === "playing" ? "Interviewer is speaking" : recorderStatus === "recording" ? "Listening to your answer" : isBackend ? "Voice interviewer ready" : "Text-only simulated interviewer"}</span>
                  <h2>RUPrepped Interviewer</h2>
                  <p>{isBackend ? "ElevenLabs question voice and answer transcription" : "Voice service is available in backend mode"}</p>
                </div>
                <div className="progress-circle"><strong>{index + (done ? 0 : 1)}</strong><small>of {session.questionCount}</small></div>
              </div>
              {!current ? <div className="completion-message"><CheckCircle2 /><h2>Practice sequence complete.</h2><p>Review your available session feedback when you’re ready.</p></div> : <>
                <Badge tone="violet">{current.category} · ~{current.estimatedMinutes} min</Badge>
                <h1>{current.prompt}</h1>
                {isBackend && <Button type="button" variant="secondary" className="voice-replay" onClick={() => void playCurrentQuestion()} disabled={paused || audioLoading || playbackStatus === "loading" || recorderStatus === "recording" || transcribing}><Volume2 size={16} /> {audioLoading || playbackStatus === "playing" ? "Playing question…" : "Replay question"}</Button>}
                <div className="answer-box">
                  <label htmlFor="answer">{isBackend ? "Your answer transcript" : "Your simulated text answer"}</label>
                  <textarea id="answer" aria-describedby="answer-help" value={text} onChange={(event) => setText(event.target.value)} placeholder={isBackend ? "Record an answer or type your transcript here." : "Type your answer here. This interface does not record audio or analyze your camera."} rows={6} disabled={paused || busy || recorderStatus === "recording" || transcribing} />
                  <div><small id="answer-help">{text.trim().split(/\s+/).filter(Boolean).length} words{busy && " · Your answer is being evaluated"}</small><Button type="button" onClick={() => void submit()} disabled={!text.trim() || paused || busy || recorderStatus === "recording" || transcribing}>{busy ? "Sending…" : <>Submit Answer <Send size={16} /></>}</Button></div>
                </div>
              </>}
            </Card>
            <Card className="controls-card">
              <button type="button" onClick={togglePause} disabled={busy}><Pause size={17} /> {paused ? "Resume simulation" : "Pause simulation"}</button>
              {isBackend ? recorderStatus === "recording" ? <button type="button" onClick={() => void stopRecordingAndTranscribe()} disabled={paused || transcribing}><Square size={16} /> Stop &amp; transcribe</button> : <button type="button" onClick={() => void startRecording()} disabled={paused || busy || transcribing || done || audioLoading || playbackStatus === "loading" || playbackStatus === "playing" || recorderStatus === "requesting-permission"}><Mic size={16} /> {recorderStatus === "requesting-permission" ? "Requesting microphone…" : "Record answer"}</button> : <span><MicOff size={16} /> Microphone available in backend mode</span>}
              {transcribing && <span><Mic size={16} /> Transcribing your answer…</span>}
              <button type="button" className="finish" onClick={() => void complete()} disabled={busy || recorderStatus === "recording" || transcribing || (isBackend && !done)}><FastForward size={17} /> Finish Interview</button>
            </Card>
            {(error || voiceError || playbackError || recorderError) && <div className="request-notice" role="alert"><strong>Something needs your attention</strong><p>{error ?? voiceError ?? playbackError ?? recorderError}</p>{!busy && text.trim() && <small>Your answer is still here—correct the issue and retry.</small>}</div>}
          </section>
          <aside className="interview-side">
            <Card className="calibration-card"><div className="side-title"><div><small>CHALLENGE CALIBRATION</small><h2>Level {displayedDifficulty}<span> / 5</span></h2></div><Sparkles size={20} /></div><div className="level-bars">{[1, 2, 3, 4, 5].map((bar) => <i className={bar <= (displayedDifficulty ?? 0) ? "active" : ""} key={bar} />)}</div><p aria-live="polite"><strong>{isBackend && latestCalibration ? adjustmentTitle : isBackend ? current?.difficulty ? "Starting backend question level" : "Difficulty level unavailable" : latestCalibration ? adjustmentTitle : "Starting point set"}</strong>{isBackend ? latestCalibration?.rationale ?? (current?.difficulty ? "This value came from the current backend question. An adjustment rationale will appear after an evaluated answer." : "The backend did not provide difficulty for this question, so no calibration event is inferred.") : latestCalibration?.rationale ?? "This level came from the session setting you selected."}</p><div className="signal-status"><Coffee size={16} /><span><strong>Camera signal unavailable</strong>The current backend does not provide camera or physiological input.</span></div></Card>
            <Card className="transcript-card"><div className="side-title"><div><small>SESSION TRANSCRIPT</small><h2>Practice history</h2></div><span className="transcript-count">{session.transcript.length}</span></div><div className="transcript-list">{session.transcript.map((event) => <article className={event.speaker} key={event.id}><small>{event.speaker === "interviewer" ? "INTERVIEWER" : "YOU"}</small><p>{event.text}</p></article>)}</div></Card>
            {session.answers.at(-1)?.evaluation && <Card className="transcript-card"><div className="side-title"><div><small>LATEST {session.answers.at(-1)?.evaluation?.evaluationSource.toUpperCase()} EVALUATION</small><h2>{session.answers.at(-1)?.evaluation?.score}/100</h2></div><Badge tone="muted">{session.answers.at(-1)?.evaluation?.evaluationSource}</Badge></div><p className="evaluation-copy">{session.answers.at(-1)?.evaluation?.feedback}</p></Card>}
          </aside>
        </div>
        <div className="progress-footer"><span>Interview progress</span><div role="progressbar" aria-label="Interview completion" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><i style={{ width: `${progress}%` }} /></div><strong>{index} of {session.questionCount} answered</strong></div>
      </main>
    </AppShell>
  );
}
