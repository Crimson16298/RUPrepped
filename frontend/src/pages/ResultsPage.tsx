import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
  CircleAlert,
  Lightbulb,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { AppShell, Stepper } from "../components/AppShell";
import { Badge, Button, Card, ScoreRing } from "../components/ui";
import { useSession } from "../context/SessionContext";
import type { RubricScores } from "../types/interview";

const rubricLabels: Array<[keyof RubricScores, string]> = [
  ["relevance", "Relevance"],
  ["completeness", "Completeness"],
  ["clarity", "Clarity"],
  ["reasoning", "Reasoning"],
  ["technicalCorrectness", "Technical correctness"],
  ["concreteDetails", "Concrete details"],
];

function RubricGrid({ rubric }: { rubric: RubricScores }) {
  return (
    <section className="rubric-panel" aria-label="Provider content rubric">
      <small>CONTENT RUBRIC</small>
      <dl className="rubric-grid">
        {rubricLabels.map(([key, label]) => (
          <div key={key}>
            <dt>{label}</dt>
            <dd>{rubric[key] ?? "N/A"}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function ResultsPage() {
  const navigate = useNavigate();
  const { session, results, reset } = useSession();
  if (!results || !session)
    return (
      <AppShell>
        <main className="empty-state">
          <CircleAlert />
          <h1>Results aren’t available yet</h1>
          <p>Complete an interview to see its available feedback.</p>
          <Button onClick={() => navigate("/setup")}>Start a session</Button>
        </main>
      </AppShell>
    );
  const startAgain = () => {
    reset();
    navigate("/setup");
  };

  if (results.mode === "backend") {
    const isGemini = results.providerMode === "gemini";
    const sources = [
      ...new Set(
        results.evaluations.map(
          ({ evaluation }) => evaluation.evaluationSource,
        ),
      ),
    ].join(", ");
    return (
      <AppShell>
        <main className="page-wrap results-page">
          <Stepper current={3} />
          <header className="results-head">
            <div>
              <Badge>
                {isGemini
                  ? "Gemini-backed session review"
                  : "Mock-provider session review"}
              </Badge>
              <h1>Question feedback is ready.</h1>
              <p>
                {isGemini
                  ? "These are the Gemini evaluations returned by FastAPI for this session."
                  : "These are deterministic mock evaluations returned by FastAPI for this session."}{" "}
                They measure answer content only—not voice, camera,
                physiological, or personality signals.
              </p>
            </div>
            <Button onClick={startAgain}>
              <RotateCcw size={16} /> Start Another Interview
            </Button>
          </header>
          <Card className="score-overview">
            <div className="overall">
              <div>
                <h2>Session {results.sessionId}</h2>
                <p>
                  Provider mode: <strong>{results.providerMode}</strong>.
                  Evaluation provenance: <strong>{sources}</strong>.
                </p>
                <span>
                  <Sparkles size={15} /> Backend session completed
                </span>
              </div>
            </div>
            <Badge tone="muted">
              {results.evaluations.length} answers evaluated
            </Badge>
          </Card>
          <div className="results-grid">
            <section>
              <Card className="feedback-list">
                <div className="card-heading">
                  <div>
                    <small>FASTAPI EVALUATIONS</small>
                    <h2>Question-by-question feedback</h2>
                  </div>
                  <BarChart3 />
                </div>
                {results.evaluations.map(({ question, evaluation }) => (
                  <article key={question.id}>
                    <div>
                      <span>{evaluation.score}</span>
                      <div>
                        <strong>{question.prompt}</strong>
                        <p>{evaluation.feedback}</p>
                        <small className="evaluation-source">
                          Source: {evaluation.evaluationSource} ·{" "}
                          {evaluation.isMock
                            ? "mock evaluation"
                            : "provider evaluation"}
                        </small>
                        <RubricGrid rubric={evaluation.rubric} />
                      </div>
                    </div>
                    <i style={{ width: `${evaluation.score}%` }} />
                  </article>
                ))}
              </Card>
            </section>
            <aside>
              <Card className="insight-card strengths">
                <CheckCircle2 />
                <small>BACKEND STRENGTHS</small>
                <h2>What worked</h2>
                <ul>
                  {results.evaluations
                    .flatMap((item) => item.evaluation.strengths)
                    .map((value, index) => (
                      <li key={`${value}-${index}`}>{value}</li>
                    ))}
                </ul>
              </Card>
              <Card className="insight-card opportunities">
                <Lightbulb />
                <small>BACKEND IMPROVEMENTS</small>
                <h2>Try next</h2>
                <ul>
                  {results.evaluations
                    .flatMap((item) => item.evaluation.improvements)
                    .map((value, index) => (
                      <li key={`${value}-${index}`}>{value}</li>
                    ))}
                </ul>
              </Card>
            </aside>
          </div>
          <section className="timeline">
            <div>
              <small>BACKEND DIFFICULTY PROGRESSION</small>
              <h2>Challenge adjustments</h2>
              <p className="score-disclaimer">
                Each adjustment is based on the backend evaluation policy. No
                camera, voice, or physiological signals are included.
              </p>
            </div>
            {session.calibration.map((event, index) => (
              <article key={`${event.questionId}-${index}`}>
                <span>Q{index + 1}</span>
                <div>
                  <strong>
                    Level {event.previousLevel} → {event.nextLevel}
                  </strong>
                  <p>{event.rationale}</p>
                </div>
                <Badge tone="muted">{event.decision}</Badge>
              </article>
            ))}
          </section>
        </main>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <main className="page-wrap results-page">
        <Stepper current={3} />
        <header className="results-head">
          <div>
            <Badge>Simulated session review</Badge>
            <h1>You showed up. Now build on it.</h1>
            <p>
              These scores and notes are illustrative mock data—not objective
              measures of confidence, personality, vocal delivery, or camera
              signals.
            </p>
          </div>
          <Button onClick={startAgain}>
            <RotateCcw size={16} /> Start Another Interview
          </Button>
        </header>
        <Card className="score-overview">
          <div className="overall">
            <ScoreRing
              value={results.overallScore}
              label="Overall practice score"
            />
            <div>
              <h2>Solid foundation, clear next steps.</h2>
              <p>
                Your mock session showed strong content structure. The
                highest-impact next step is to make your examples more
                measurable and concise.
              </p>
              <span>
                <Sparkles size={15} /> Generated from demo-mode simulated
                feedback
              </span>
            </div>
          </div>
          <div className="score-split">
            <ScoreRing value={results.contentScore} label="Content & clarity" />
            <ScoreRing value={results.deliveryScore} label="Delivery*" />
          </div>
        </Card>
        <p className="score-disclaimer">
          *Delivery is illustrative only. A text-only practice session cannot
          measure speaking pace, filler words, vocal delivery, or observable
          presentation behavior.
        </p>
        <div className="results-grid">
          <section>
            <Card className="feedback-list">
              <div className="card-heading">
                <div>
                  <small>QUESTION-BY-QUESTION</small>
                  <h2>What landed</h2>
                </div>
                <BarChart3 />
              </div>
              {results.questionFeedback.map((item) => (
                <article key={item.questionId}>
                  <div>
                    <span>{item.score}</span>
                    <div>
                      <strong>{item.question}</strong>
                      <p>{item.note}</p>
                    </div>
                  </div>
                  <i style={{ width: `${item.score}%` }} />
                </article>
              ))}
            </Card>
          </section>
          <aside>
            <Card className="insight-card strengths">
              <CheckCircle2 />
              <small>KEEP DOING</small>
              <h2>Strengths</h2>
              <ul>
                {results.strengths.map((value) => (
                  <li key={value}>{value}</li>
                ))}
              </ul>
            </Card>
            <Card className="insight-card opportunities">
              <Lightbulb />
              <small>TRY NEXT</small>
              <h2>Improvement opportunities</h2>
              <ul>
                {results.opportunities.map((value) => (
                  <li key={value}>{value}</li>
                ))}
              </ul>
            </Card>
          </aside>
        </div>
        <section className="follow-up">
          <div>
            <Badge tone="violet">Recommended next practice</Badge>
            <h2>Keep the momentum.</h2>
            <p>Use one of these targeted prompts for your next session.</p>
          </div>
          <div>
            {results.followUps.map((question, index) => (
              <button onClick={startAgain} key={question}>
                <span>0{index + 1}</span>
                {question}
                <ArrowRight size={17} />
              </button>
            ))}
          </div>
        </section>
        <section className="timeline">
          <div>
            <small>SESSION EVENT TIMELINE</small>
            <h2>Challenge changes</h2>
          </div>
          {session.calibration.map((event, index) => (
            <article key={`${event.questionId}-${index}`}>
              <span>Q{index + 1}</span>
              <div>
                <strong>
                  Level {event.previousLevel} → {event.nextLevel}
                </strong>
                <p>{event.rationale}</p>
              </div>
              <Badge tone="muted">Mock decision</Badge>
            </article>
          ))}
        </section>
      </main>
    </AppShell>
  );
}
