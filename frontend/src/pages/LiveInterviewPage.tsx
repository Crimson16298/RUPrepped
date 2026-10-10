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
import { fetchQuestionAudio, transcribeRecording, VoiceRequestError } from "../services/voiceClient";

function elapsed(startedAt: string) {
  const seconds = Math.max(
    0,
    Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000),
  );
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
  const spokenQuestionRef = useRef<string | null>(null);
  const playback = useAudioPlayback();
  const recorder = useMicrophoneRecorder();
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
  const done = !current;
  const latestCalibration = session?.calibration.at(-1);
  const progress = session ? Math.round((index / session.questionCount) * 100) : 0;
  const isBackend = session?.mode === "backend";
  const playCurrentQuestion = useCallback(async () => {
    if (!isBackend || !current) return;
    setVoiceError(null);
    try {
      const audio = await fetchQuestionAudio(voiceBaseUrl, current.prompt);
      await playback.play(audio);
    } catch (cause) {
      if (cause instanceof VoiceRequestError) setVoiceError(cause.message);
      else if (!playback.error) setVoiceError("The question audio could not be played. Try replaying it.");
    }
  }, [current, isBackend, playback, voiceBaseUrl]);
  useEffect(() => {
    if (!isBackend || !current || spokenQuestionRef.current === current.id) return;
    spokenQuestionRef.current = current.id;
    void playCurrentQuestion();
  }, [current, isBackend, playCurrentQuestion]);
  if (!session)
    return (
      <AppShell>
        <main className="empty-state">
          <TriangleAlert />
          <h1>No active practice session</h1>
          <p>Set up a mock interview before entering the room.</p>
          <Button onClick={() => navigate("/setup")}>Go to setup</Button>
        </main>
      </AppShell>
    );
  async function startRecording() {
    setVoiceError(null);
    try {
      await recorder.start();
    } catch (cause) {
      setVoiceError(cause instanceof Error ? cause.message : "Unable to start microphone recording.");
    }
  }
  async function stopRecordingAndTranscribe() {
    setVoiceError(null);
    try {
      const recording = await recorder.stop();
      setTranscribing(true);
      const transcript = await transcribeRecording(voiceBaseUrl, recording);
      setText(transcript);
    } catch (cause) {
      setVoiceError(cause instanceof Error ? cause.message : "Unable to transcribe the recording.");
    } finally {
      setTranscribing(false);
    }
  }
  async function submit() {
    if (!text.trim() || done) return;
    const accepted = await answer(text);
    if (accepted) setText("");
  }
  async function complete() {
    const completed = await finish();
    if (completed) navigate("/results");
  }
  return (
    <AppShell>
      <main className="page-wrap interview-page">
        <Stepper current={2} />
        <div className="interview-meta">
          <div>
              <Badge>{isBackend ? "Backend interview in progress" : "Mock interview in progress"}</Badge>
            <span>{session.setup.objective}</span>
          </div>
          <div>
            <Clock3 size={17} />
            <strong>{time}</strong>
            <span>Simulated timer</span>
          </div>
        </div>
        <div className="interview-grid">
          <section className="interview-main">
            <Card className="interviewer-card">
              <div className="interviewer-top">
                <div className="interviewer-avatar">
                  <Bot size={34} />
                </div>
                <div>
                  <span className="speaking-pill">
                    <i /> {playback.status === "playing" ? "Interviewer is speaking" : recorder.status === "recording" ? "Listening to your answer" : isBackend ? "Voice interviewer ready" : "Text-only simulated interviewer"}
                  </span>
                  <h2>RUPrepped Interviewer</h2>
                  <p>{isBackend ? "ElevenLabs question voice and answer transcription" : "Voice service is available in backend mode"}</p>
                </div>
                <div className="progress-circle">
                  <strong>{index + (done ? 0 : 1)}</strong>
                  <small>of {session.questionCount}</small>
                </div>
              </div>
              {done ? (
                <div className="completion-message">
                  <CheckCircle2 />
                  <h2>Practice sequence complete.</h2>
                  <p>Review your simulated feedback when you’re ready.</p>
                </div>
              ) : (
                <>
                  <Badge tone="violet">
                    {current.category} · ~{current.estimatedMinutes} min
                  </Badge>
                  <h1>{current.prompt}</h1>
                  {isBackend && <Button type="button" variant="secondary" className="voice-replay" onClick={() => void playCurrentQuestion()} disabled={paused || playback.status === "loading" || recorder.status === "recording"}>
                    <Volume2 size={16} /> {playback.status === "playing" ? "Playing question…" : "Replay question"}
                  </Button>}
                  <div className="answer-box">
                    <label htmlFor="answer">{isBackend ? "Your answer transcript" : "Your simulated text answer"}</label>
                    <textarea
                      id="answer"
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      placeholder={isBackend ? "Record an answer or type your transcript here." : "Type your answer here. This interface does not record audio or analyze your camera."}
                      rows={6}
                      disabled={paused || busy || recorder.status === "recording" || transcribing}
                    />
                    <div>
                      <small>
                        {text.trim().split(/\s+/).filter(Boolean).length} words
                      </small>
                      <Button
                        type="button"
                        onClick={submit}
                        disabled={!text.trim() || paused || busy || transcribing}
                      >
                        {busy ? (
                          "Sending…"
                        ) : (
                          <>
                            Submit Answer <Send size={16} />
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </Card>
            <Card className="controls-card">
              <button type="button" onClick={() => setPaused(!paused)}>
                <Pause size={17} />{" "}
                {paused ? "Resume simulation" : "Pause simulation"}
              </button>
              {isBackend ? recorder.status === "recording" ? (
                <button type="button" onClick={() => void stopRecordingAndTranscribe()} disabled={paused || transcribing}>
                  <Square size={16} /> Stop &amp; transcribe
                </button>
              ) : (
                <button type="button" onClick={() => void startRecording()} disabled={paused || busy || transcribing || done}>
                  <Mic size={16} /> {recorder.status === "requesting-permission" ? "Requesting microphone…" : "Record answer"}
                </button>
              ) : <span><MicOff size={16} /> Microphone available in backend mode</span>}
              {transcribing && <span><Mic size={16} /> Transcribing your answer…</span>}
              <button
                type="button"
                className="finish"
                onClick={complete}
                disabled={busy || (isBackend && !done)}
              >
                <FastForward size={17} /> Finish Interview
              </button>
            </Card>
            {(error || voiceError || playback.error || recorder.error) && <p className="error-message" role="alert">{error ?? voiceError ?? playback.error ?? recorder.error} {!busy && text.trim() && " Your answer is still here—correct the issue and retry."}</p>}
          </section>
          <aside className="interview-side">
            <Card className="calibration-card">
              <div className="side-title">
                <div>
                  <small>CHALLENGE CALIBRATION</small>
                  <h2>
                    Level {session.setup.difficulty}
                    <span> / 5</span>
                  </h2>
                </div>
                <Sparkles size={20} />
              </div>
              <div className="level-bars">
                {[1, 2, 3, 4, 5].map((bar) => (
                  <i
                    className={bar <= session.setup.difficulty ? "active" : ""}
                    key={bar}
                  />
                ))}
              </div>
              <p>
                <strong>
                  {latestCalibration
                    ? latestCalibration.decision === "increase"
                      ? "Slightly harder next"
                      : "Holding steady"
                    : "Starting point set"}
                </strong>
                {latestCalibration?.rationale ??
                  "This level came from the session setting you selected."}
              </p>
              <div className="signal-status">
                <Coffee size={16} />
                <span>
                  <strong>Camera signal unavailable</strong>The current backend
                  does not provide camera or physiological input.
                </span>
              </div>
            </Card>
            <Card className="transcript-card">
              <div className="side-title">
                <div>
                  <small>SESSION TRANSCRIPT</small>
                  <h2>Practice history</h2>
                </div>
                <span className="transcript-count">
                  {session.transcript.length}
                </span>
              </div>
              <div className="transcript-list">
                {session.transcript.map((event) => (
                  <article className={event.speaker} key={event.id}>
                    <small>
                      {event.speaker === "interviewer" ? "INTERVIEWER" : "YOU"}
                    </small>
                    <p>{event.text}</p>
                  </article>
                ))}
              </div>
            </Card>
            {session.answers.at(-1)?.evaluation && <Card className="transcript-card"><div className="side-title"><div><small>LATEST BACKEND EVALUATION</small><h2>{session.answers.at(-1)?.evaluation?.score}/100</h2></div><Badge tone="muted">{session.answers.at(-1)?.evaluation?.evaluationSource}</Badge></div><p className="evaluation-copy">{session.answers.at(-1)?.evaluation?.feedback}</p></Card>}
          </aside>
        </div>
        <div className="progress-footer">
          <span>Interview progress</span>
          <div>
            <i style={{ width: `${progress}%` }} />
          </div>
          <strong>
            {index} of {session.questionCount} answered
          </strong>
        </div>
      </main>
    </AppShell>
  );
}
