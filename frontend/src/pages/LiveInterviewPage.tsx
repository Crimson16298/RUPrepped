import {
  Bot,
  CheckCircle2,
  Clock3,
  Coffee,
  FastForward,
  MicOff,
  Pause,
  Send,
  Sparkles,
  TriangleAlert,
} from "lucide-react";

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppShell, Stepper } from "../components/AppShell";
import { Badge, Button, Card } from "../components/ui";
import { useSession } from "../context/SessionContext";

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
  useEffect(() => {
    if (!session || paused) return;
    const tick = () => setTime(elapsed(session.startedAt));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [session, paused]);
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
  const index = session.answers.length;
  const current = session.questions[index];
  const done = !current;
  const latestCalibration = session.calibration.at(-1);
  const progress = Math.round((index / session.questions.length) * 100);
  async function submit() {
    if (!text.trim() || done) return;
    await answer(text);
    setText("");
  }
  async function complete() {
    await finish();
    navigate("/results");
  }
  return (
    <AppShell>
      <main className="page-wrap interview-page">
        <Stepper current={2} />
        <div className="interview-meta">
          <div>
            <Badge>Mock interview in progress</Badge>
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
                    <i /> Text-only simulated interviewer
                  </span>
                  <h2>RUPrepped Interviewer</h2>
                  <p>Voice service not connected</p>
                </div>
                <div className="progress-circle">
                  <strong>{index + (done ? 0 : 1)}</strong>
                  <small>of {session.questions.length}</small>
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
                  <div className="answer-box">
                    <label htmlFor="answer">Your simulated text answer</label>
                    <textarea
                      id="answer"
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      placeholder="Type your answer here. This demo does not record audio or analyze your camera."
                      rows={6}
                      disabled={paused || busy}
                    />
                    <div>
                      <small>
                        {text.trim().split(/\s+/).filter(Boolean).length} words
                      </small>
                      <Button
                        type="button"
                        onClick={submit}
                        disabled={!text.trim() || paused || busy}
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
              <span>
                <MicOff size={16} /> Microphone unavailable in mock mode
              </span>
              <button
                type="button"
                className="finish"
                onClick={complete}
                disabled={busy}
              >
                <FastForward size={17} /> Finish Interview
              </button>
            </Card>
            {error && <p className="error-message">{error}</p>}
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
                  <strong>Camera signal unavailable</strong>Mock demo uses no
                  camera or physiological input.
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
          </aside>
        </div>
        <div className="progress-footer">
          <span>Interview progress</span>
          <div>
            <i style={{ width: `${progress}%` }} />
          </div>
          <strong>
            {index} of {session.questions.length} answered
          </strong>
        </div>
      </main>
    </AppShell>
  );
}
