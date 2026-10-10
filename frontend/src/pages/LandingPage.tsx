import {
  ArrowRight,
  BarChart3,
  BrainCircuit,
  Gauge,
  MessageSquareText,
  ShieldCheck,
} from "lucide-react";

import { Link } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { Badge, Button, Card } from "../components/ui";

const features = [
  {
    icon: BrainCircuit,
    title: "AI Interviews",
    text: "Practice realistic, role-aware questions in a focused interview room.",
  },
  {
    icon: Gauge,
    title: "Adaptive Challenge",
    text: "See how each next prompt is calibrated and why it changes.",
  },
  {
    icon: BarChart3,
    title: "Personalized Feedback",
    text: "Turn every session into clear talking points and next steps.",
  },
];
export function LandingPage() {
  return (
    <AppShell>
      <main>
        <section className="hero">
          <div className="hero-copy">
            <Badge>Interview practice, reimagined</Badge>
            <h1>
              Practice like it's the real thing.
              <br />
              <em>Prepare With Confidence.</em>
            </h1>
            <p>
              RUPrepped gives you a no-stakes, realistic space to rehearse that
              interview, presentation, or conversation. Then, we helps you
              understand exactly what to practice next.
            </p>
            <div className="actions">
              <Link to="/setup">
                <Button>
                  Start Practicing <ArrowRight size={17} />
                </Button>
              </Link>
              <a className="text-link" href="#how-it-works">
                See how it works
              </a>
            </div>
            <div className="trust-row">
              <span>
                <ShieldCheck size={17} /> Your practice stays yours
              </span>
              <span>
                <MessageSquareText size={17} /> Built for spoken thinking
              </span>
            </div>
          </div>
          <div className="hero-visual">
            <div className="orb orb-one" />
            <div className="orb orb-two" />
            <Card className="interviewer-preview">
              <div className="preview-head">
                <span className="avatar">
                  <BrainCircuit />
                </span>
                <div>
                  <strong>RUP Interviewer</strong>
                  <small>Ready when you are</small>
                </div>
                <i className="live-dot" />
              </div>
              <p>
                “Tell me about a project where you had to find clarity in
                ambiguity.”
              </p>
              <div className="wave">
                <i />
                <i />
                <i />
                <i />
                <i />
                <i />
                <i />
                <i />
                <i />
              </div>
              <small>Simulated practice environment</small>
            </Card>
            <Card className="mini-calibration">
              <small>CHALLENGE CALIBRATION</small>
              <strong>
                Level 3 <span>/ 5</span>
              </strong>
              <div className="meter">
                <i />
                <i />
                <i className="on" />
                <i />
                <i />
              </div>
              <p>Holding steady for the next question.</p>
            </Card>
          </div>
        </section>
        <section id="how-it-works" className="feature-section">
          <div className="section-intro">
            <Badge tone="violet">Built for deliberate practice</Badge>
            <h2>More than a question bank.</h2>
            <p>
              Every session is designed to turn uncertainty into a repeatable
              performance habit.
            </p>
          </div>
          <div className="feature-grid">
            {features.map(({ icon: Icon, title, text }) => (
              <Card key={title} className="feature-card">
                <span className="feature-icon">
                  <Icon />
                </span>
                <h3>{title}</h3>
                <p>{text}</p>
              </Card>
            ))}
          </div>
        </section>
        <section id="about" className="how-card">
          <span>01</span>
          <div>
            <h2>Set your context.</h2>
            <p>
              Choose the conversation you want to practice, your goal, and the
              right amount of challenge.
            </p>
          </div>
          <span>02</span>
          <div>
            <h2>Think out loud.</h2>
            <p>Respond to a focused sequence of questions at your own pace.</p>
          </div>
          <span>03</span>
          <div>
            <h2>Leave with direction.</h2>
            <p>
              Review illustrative feedback and take your next practice prompt
              with you.
            </p>
          </div>
        </section>
      </main>
    </AppShell>
  );
}
