# RUPrepped backend handoff — Milestone 1B

**Scope:** deterministic local mock backend. It does not call Gemini,
ElevenLabs, Presage, Tiger Data, or a database.

## Run locally

```sh
cd backend
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

OpenAPI: `http://127.0.0.1:8000/docs`.

## Available endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Check backend availability. |
| `POST` | `/api/sessions` | Create an in-memory interview session. |
| `POST` | `/api/sessions/{session_id}/start` | Start once and receive question one. |
| `POST` | `/api/sessions/{session_id}/answers` | Submit the current answer, receive mock feedback and the next question. |
| `POST` | `/api/voice/synthesize` | Convert a question-text JSON body into playable MP3 audio. |
| `POST` | `/api/voice/transcribe` | Convert one browser-recorded multipart audio file into a transcript. |

Create a session:

```json
{
  "interview_type": "technical",
  "difficulty": 3,
  "question_count": 3,
  "target_role_or_subject": "Backend software engineering intern",
  "job_description": "Build and maintain API services.",
  "resume_text": "Optional résumé text."
}
```

`interview_type` is `behavioral`, `technical`, or `mixed`; difficulty is an
integer `1..5`; `question_count` is `1..10`. The three context fields are
optional. Creation returns an opaque `session_id`.

Submit the answer to `current_question.question_id`:

```json
{
  "question_id": "q_technical-validation_3",
  "transcript": "I would validate each request at the API boundary, return useful errors, log failures safely, and test every invalid case.",
  "audio_reference": "optional-client-turn-id"
}
```

Example response:

```json
{
  "answer_id": "ans_01",
  "status": "accepted",
  "session_status": "in_progress",
  "evaluation": {
    "evaluation_source": "mock_deterministic",
    "is_mock": true,
    "score": 70,
    "strengths": ["Provided a relevant response with a clear starting point."],
    "improvements": ["Add more context, actions, and an outcome to strengthen the answer."],
    "feedback": "Mock evaluation: expand the example into a complete explanation."
  },
  "next_question": { "question_id": "q_technical-debugging_3" }
}
```

The final answer returns `session_status: "completed"` and
`next_question: null`.

## Frontend and voice integration

Use `POST /api/sessions`, then `/start` exactly once. Submit answers in order
with `/answers`; render mock feedback only as mock feedback. Handle `409` error
codes for repeat start, answering before start, duplicate/out-of-order answers,
and completed sessions. Local React development origins on ports `3000` and
`5173` are permitted by CORS.

P4.3 voice integration is contained in `backend/app/services/speech.py`,
`frontend/src/services/voiceClient.ts`, and the reusable hooks
`frontend/src/hooks/useAudioPlayback.ts` and
`frontend/src/hooks/useMicrophoneRecorder.ts`. `LiveInterviewPage` automatically
requests question audio in backend mode, offers Replay question, records an
answer, then places the returned transcript in the existing answer textarea.
The user still reviews and submits that transcript through the existing session
endpoint, preserving Person 1's answer lifecycle.

Use JSON `{ "text": "..." }` with `/api/voice/synthesize`; its response is
`audio/mpeg`. Use multipart field `file` with `/api/voice/transcribe`; its
response is `{ "transcript": "..." }`. The frontend prefers WebM/Opus and
falls back to MP4 or OGG, all of which ElevenLabs Scribe accepts. Keep
`ELEVENLABS_API_KEY` and `ELEVENLABS_VOICE_ID` in the backend `.env` only; no
`VITE_` ElevenLabs variables are required or permitted.

Person 1 does not need to add session routes or alter schemas for P4.3. For a
future Gemini turn engine, call the same synthesis endpoint after every new
question and pass the transcription result into the existing answer/evaluation
path. The optional `audio_reference` remains available for a future durable
recording identifier; P4.3 intentionally does not retain raw candidate audio.

## Presage and calibration integration

Use the backend-created `session_id` and the returned `question_id` to associate
future measurement events. No sensor value is currently accepted or inferred.
Challenge calibration must remain an external decision until the planned
`POST /api/sessions/{id}/metrics` interface and metric taxonomy are approved.

## Mock versus live behavior

Questions and evaluations are deterministic test fixtures. The response labels
`evaluation_source: "mock_deterministic"` and `is_mock: true` are intentional.
Gemini question generation/evaluation, database persistence, measurement
ingestion, authentication, and reports are not implemented.

## Decisions awaiting team approval

1. Retain `target_role_or_subject` or use separate role and subject fields.
2. Confirm transcript/context length limits and the `audio_reference` convention.
3. Define Tiger Data measurement names, units, deduplication, and retention.
4. Define how Person 3’s calibration may affect future question difficulty.
