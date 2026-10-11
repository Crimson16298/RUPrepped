import {
  Camera,
  Check,
  ChevronRight,
  FileUp,
  GraduationCap,
  MessageCircleHeart,
  Mic2,
  Presentation,
  Sparkles,
} from "lucide-react";

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { AppShell, Stepper } from "../components/AppShell";
import { Badge, Button, Card } from "../components/ui";
import { useSession } from "../context/SessionContext";
import { interviewMode } from "../services/interviewAdapter";
import { extractResume } from "../services/resumeClient";
import type { Difficulty, PracticeType } from "../types/interview";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000";
type ResumeUploadStatus = "idle" | "uploading" | "success" | "error";

const modes: Array<{
  id: PracticeType;
  title: string;
  description: string;
  icon: typeof Mic2;
}> = [
  {
    id: "job",
    title: "Job Interview",
    description: "Role-specific conversation practice",
    icon: Mic2,
  },
  {
    id: "oral-exam",
    title: "Oral Exam",
    description: "Explain concepts under pressure",
    icon: GraduationCap,
  },
  {
    id: "presentation",
    title: "Presentation",
    description: "Refine your delivery and flow",
    icon: Presentation,
  },
  {
    id: "social",
    title: "Social Practice",
    description: "Build confidence in conversation",
    icon: MessageCircleHeart,
  },
];
export function SessionSetupPage() {
  const navigate = useNavigate();
  const { start, busy, error } = useSession();
  const [practiceType, setPracticeType] = useState<PracticeType>("job");
  const [objective, setObjective] = useState("Software Engineering Intern");
  const [jobDescription, setJobDescription] = useState("");
  const [difficulty, setDifficulty] = useState<Difficulty>(3);
  const [lengthMinutes, setLength] = useState(10);
  const [cameraConsent, setCameraConsent] = useState(false);
  const [resumeName, setResumeName] = useState("");
  const [resumeText, setResumeText] = useState("");
  const [resumeUploadStatus, setResumeUploadStatus] = useState<ResumeUploadStatus>("idle");
  const [resumeError, setResumeError] = useState<string | null>(null);
  const uploadVersion = useRef(0);
  const uploadController = useRef<AbortController | null>(null);

  useEffect(() => () => uploadController.current?.abort(), []);

  async function chooseResume(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.currentTarget.value = "";
    uploadVersion.current += 1;
    const version = uploadVersion.current;
    uploadController.current?.abort();
    uploadController.current = null;
    setResumeName(file?.name ?? "");
    setResumeText("");
    setResumeError(null);
    setResumeUploadStatus(file ? "uploading" : "idle");
    if (!file) return;
    if (interviewMode !== "backend") {
      setResumeUploadStatus("error");
      setResumeError("Resume personalization is available when backend mode is enabled.");
      return;
    }
    const controller = new AbortController();
    uploadController.current = controller;
    try {
      const extracted = await extractResume(apiBaseUrl, file, controller.signal);
      if (uploadVersion.current !== version) return;
      setResumeName(extracted.filename);
      setResumeText(extracted.resumeText);
      setResumeUploadStatus("success");
    } catch (cause) {
      if (uploadVersion.current !== version || (cause instanceof DOMException && cause.name === "AbortError")) return;
      setResumeUploadStatus("error");
      setResumeError(cause instanceof Error ? cause.message : "Unable to extract this resume.");
    } finally {
      if (uploadVersion.current === version) uploadController.current = null;
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    const started = await start({
      practiceType,
      objective: objective.trim() || "General practice",
      jobDescription,
      resumeText: resumeText || undefined,
      difficulty,
      lengthMinutes,
      cameraEnabled: cameraConsent,
    });
    if (started) navigate("/interview");
  }
  return (
    <AppShell>
      <main className="page-wrap">
        <Stepper current={1} />
        <div className="page-heading">
          <Badge>Session setup</Badge>
          <h1>Make this practice count.</h1>
          <p>
            Set a clear focus. You can adjust how challenging the simulated
            questions feel.
          </p>
        </div>
        <form className="setup-grid" onSubmit={submit}>
          <div className="form-main">
            <Card>
              <fieldset>
                <legend>What would you like to practice?</legend>
                <div className="mode-grid">
                  {modes.map(({ id, title, description, icon: Icon }) => (
                    <button
                      type="button"
                      key={id}
                      className={`mode-card ${practiceType === id ? "selected" : ""}`}
                      onClick={() => setPracticeType(id)}
                    >
                      <Icon />
                      <strong>{title}</strong>
                      <small>{description}</small>
                      {practiceType === id && (
                        <span>
                          <Check size={14} />
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </fieldset>
            </Card>
            <Card className="details-card">
              <label>
                Target role, topic, or objective
                <input
                  value={objective}
                  onChange={(e) => setObjective(e.target.value)}
                  placeholder="e.g. Product manager interview"
                />
              </label>
              <label>
                Job description <small>optional</small>
                <textarea
                  value={jobDescription}
                  onChange={(e) => setJobDescription(e.target.value)}
                  placeholder="Paste a role description or the topics you want to cover."
                  rows={4}
                />
              </label>
              <label className="upload-box">
                <FileUp size={21} />
                <span>
                  <strong>{resumeUploadStatus === "uploading" ? "Extracting resume…" : resumeName || "Add a resume"}</strong>
                  <small>Optional · PDF or TXT · 5 MiB maximum</small>
                </span>
                <input
                  type="file"
                  accept=".pdf,.txt"
                  aria-label="Add a resume"
                  onChange={chooseResume}
                />
              </label>
              <p className="field-note">
                {resumeUploadStatus === "success"
                  ? "Resume extracted and ready to personalize this session."
                  : "Optional · resume text is sent only to the local interview backend for this session."}
              </p>
              {resumeError && <p className="error-message resume-error">{resumeError}</p>}
            </Card>
          </div>
          <aside className="setup-side">
            <Card>
              <h2>Session settings</h2>
              <label>
                Starting challenge{" "}
                <span className="range-value">{difficulty} / 5</span>
                <input
                  aria-label="Starting challenge"
                  type="range"
                  min="1"
                  max="5"
                  value={difficulty}
                  onChange={(e) =>
                    setDifficulty(Number(e.target.value) as Difficulty)
                  }
                />
                <div className="range-labels">
                  <small>Supportive</small>
                  <small>Stretch</small>
                </div>
              </label>
              <label>
                Interview length
                <select
                  value={lengthMinutes}
                  onChange={(e) => setLength(Number(e.target.value))}
                >
                  <option value={5}>5 minutes · Quick practice</option>
                  <option value={10}>10 minutes · Focused session</option>
                  <option value={20}>20 minutes · Deep practice</option>
                </select>
              </label>
              <div className="consent">
                <Camera size={20} />
                <div>
                  <strong>
                    Optional camera measurement context <span>optional</span>
                  </strong>
                  <p>
                    Camera measurements are not required for your interview. If an
                    approved integration becomes available, it may provide measurement
                    summaries only—it does not assess emotions, stress, or medical data.
                  </p>
                  <label className="camera-consent-choice">
                    <input
                      type="checkbox"
                      checked={cameraConsent}
                      onChange={(event) => setCameraConsent(event.target.checked)}
                    />
                    <span>I opt in to optional camera-derived measurement summaries for this session.</span>
                  </label>
                  <small>
                    {cameraConsent
                      ? "Consent is saved for this session. No camera permission is requested until an approved integration is connected."
                      : "Continue without camera access or measurement collection."}
                  </small>
                </div>
              </div>
            </Card>
            <Button type="submit" className="start-button" disabled={busy || resumeUploadStatus === "uploading"}>
              {busy || resumeUploadStatus === "uploading" ? (
                "Preparing session…"
              ) : (
                <>
                  Start Interview <ChevronRight size={18} />
                </>
              )}
            </Button>
            {error && <p className="error-message">{error}</p>}
            <p className="demo-note">
              <Sparkles size={15} /> {interviewMode === "backend" ? "You’re starting a text-only interview backed by the local API." : "You’re starting a simulated, text-only interview."}
            </p>
          </aside>
        </form>
      </main>
    </AppShell>
  );
}
