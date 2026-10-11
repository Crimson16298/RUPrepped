# RUPrepped API contracts — proposal (Milestone 1C)

**Status:** proposed for teammate review, not a stable production API. The
Milestone 1C implements `GET /api/health`, `POST /api/sessions`,
`POST /api/sessions/{id}/start`, and `POST /api/sessions/{id}/answers`. Mock
mode is the default; Gemini mode is server-configured. It does not connect
ElevenLabs, Presage, Tiger Data, authentication providers, or a database.

All bodies are JSON, names use `snake_case`, and IDs are opaque strings.
`session_id` currently looks like `ses_<uuidhex>`; clients must not parse it.
For local frontend development, the mock allows browser requests from
`http://localhost:5173`, `http://127.0.0.1:5173`, `http://localhost:3000`, and
`http://127.0.0.1:3000`.

## Shared types

| Type | Allowed shape or values |
| --- | --- |
| `interview_type` | `"behavioral"`, `"technical"`, `"mixed"` |
| `difficulty` | integer `1` through `5`, inclusive |
| `skill_category` | `"communication"`, `"problem_solving"`, `"teamwork"`, `"technical_fundamentals"` |
| `session_status` | `"created"`, `"in_progress"`, `"completed"` |
| `provider_mode` | `"mock"` or `"gemini"`; selected by the backend environment, never by a client request |
| `question` | `question_id`, `question_text`, `skill_category`, `difficulty`, `interview_type` |

A question always supplies text for the voice/transcript pipeline plus its
evaluation metadata:

```json
{
  "question_id": "q_technical-validation_3",
  "question_text": "How would you design a service that safely accepts and validates user input?",
  "skill_category": "technical_fundamentals",
  "difficulty": 3,
  "interview_type": "technical"
}
```

## Setup context and team approval decisions

`POST /api/sessions` additionally accepts optional `target_role_or_subject`,
`job_description`, and `resume_text`. This keeps the existing fields unchanged
while supporting both job interviews and academic practice. The following
decisions are deliberately **proposed** and require team approval before a
Gemini or persistence integration:

1. Keep the inclusive `target_role_or_subject` name, or replace it with two
   separate optional fields (`target_role` and `academic_subject`).
2. Keep `transcript` as the canonical answer text and `audio_reference` as
   opaque optional metadata; no audio is uploaded to this API.
3. Keep deterministic mock scores only as test placeholders. They must not be
   displayed as Gemini assessment or merged with Person 3 measurements.
4. Agree on maximum transcript/context sizes and a durable metric taxonomy
   before Tiger Data persistence is introduced.

## Provider configuration and error behavior

Set `INTERVIEW_PROVIDER=mock` (the default) for deterministic testing. Set
`INTERVIEW_PROVIDER=gemini` plus the server-only `GEMINI_API_KEY` to enable the
official Google GenAI SDK. Optional server-only settings are `GEMINI_MODEL`
(default `gemini-3.5-flash-lite`) and `GEMINI_TIMEOUT_MS` (default 10,000; range
1..60,000). Keys are never returned or logged by this API.

Gemini uses structured JSON output validated by Pydantic. Gemini failures never
switch a session to mock mode. The backend disables SDK retries (`attempts=1`)
and applies `GEMINI_TIMEOUT_MS` to each request.

| Condition | API result |
| --- | --- |
| Missing server key | `503 provider_not_configured` |
| Upstream 400 | `502 provider_request_invalid` |
| Upstream 401/403 | `503 provider_authentication_failed` |
| Upstream 404 | `503 provider_model_unavailable` |
| Upstream 429 | `503 provider_rate_limited` |
| Upstream 5xx | `503 provider_server_error` |
| Request timeout | `504 provider_timeout` |
| DNS/TLS/proxy/connection transport error | `503 provider_network_error` |
| Malformed or duplicate model output | `502 provider_invalid_response` |

Provider errors retain the shared error envelope and may include a safe
`provider` object containing `operation`, exception class, upstream status, and
elapsed milliseconds. They never include API keys, authorization headers,
resume text, prompts, or raw provider response bodies.

## Interview state machine

`created` → `in_progress` → `completed`.

`/start` is valid only from `created`; a repeated start returns `409`
`session_already_started`. `/answers` is valid only from `in_progress` and for
the exact current question. A completed session accepts no more answers. These
rules prevent accidental duplicate voice submissions and out-of-order frontend
requests.

## Error envelope

Every documented error uses:

```json
{
  "error": {
    "code": "validation_error",
    "message": "Request validation failed.",
    "fields": { "difficulty": "Input should be less than or equal to 5" }
  }
}
```

`fields` is only returned for validation errors. Malformed JSON, missing fields,
and invalid types/values return `422`; unknown resource paths return `404`.

## Implemented endpoints

### `POST /api/resumes/extract`

Extracts text from a candidate-selected resume before the existing session is
created. This is the only resume-upload endpoint. It is independent from the
interview lifecycle and does not create a session or call Gemini.

Send `multipart/form-data` with one `file` field. Supported input is a
text-based PDF (detected from PDF content) or UTF-8 TXT (including a UTF-8 BOM).
The backend validates bytes as well as filename/content type, processes the
upload in memory only, reads at most 5 MiB plus one byte, and never persists or
logs the file contents. Uploads must be at most **5 MiB**. Returned
`resume_text` is conservatively normalized and capped at **20,000 characters**
so it can be supplied unchanged to `POST /api/sessions`.

```text
Content-Type: multipart/form-data
file: resume.pdf (application/pdf)
```

`200 OK`:

```json
{
  "filename": "resume.pdf",
  "resume_text": "EDUCATION\nRutgers University\n\nPROJECTS\nRUPrepped — FastAPI interview platform"
}
```

Errors use the shared envelope. `415 unsupported_resume_type` means the input
is not a supported PDF/TXT document; `413 resume_too_large` means it exceeds 5
MiB; `422 resume_empty`, `422 invalid_resume_text_encoding`, or `422
resume_unextractable` indicate an empty, non-UTF-8, corrupt, encrypted,
scanned-only, or otherwise text-unextractable document. Clients should show the
message and leave the user able to choose a different file.

**Frontend handoff:** (1) user selects a PDF/TXT file; (2) React uploads it to
`/api/resumes/extract`; (3) FastAPI returns `resume_text`; (4) React includes
that exact string as optional `resume_text` in `POST /api/sessions`; (5) the
session starts normally; (6) Gemini uses only stated resume skills, projects,
tools, and work experience to personalize questions. Resume and job-description
content is treated as untrusted reference data, not executable instructions.

### `GET /api/health`

`200 OK`:

```json
{ "status": "ok", "service": "ruprepped-mock-backend" }
```

### `POST /api/sessions`

Creates an in-memory session. The first question is generated at `/start` and
each later question is generated after the preceding answer is evaluated.

Request (new context fields are optional):

```json
{
  "interview_type": "technical",
  "difficulty": 3,
  "question_count": 2,
  "target_role_or_subject": "Backend software engineering intern",
  "job_description": "Build and maintain API services.",
  "resume_text": "Built a FastAPI project."
}
```

`interview_type` is required. `difficulty` defaults to `2` and is an integer
`1..5`; `question_count` defaults to `3` and is an integer `1..10`. Extra
properties are ignored by the mock and clients should not send them.
`target_role_or_subject` is at most 200 characters, `job_description` 10,000,
and `resume_text` 20,000.

`201 Created`:

```json
{
  "session_id": "ses_8b1d4a3f5c3e4a18a8e07dbe3bdcfa4e",
  "status": "created",
  "interview_type": "technical",
  "difficulty": 3,
  "question_count": 2,
  "target_role_or_subject": "Backend software engineering intern",
  "provider_mode": "mock"
}
```

Invalid input returns `422` with the error envelope.

### `POST /api/sessions/{id}/start`

Marks a `created` session `in_progress` and generates the first question using
the session's provider. A repeat call returns `409 session_already_started`.

`200 OK`:

```json
{
  "session_id": "ses_8b1d4a3f5c3e4a18a8e07dbe3bdcfa4e",
  "status": "in_progress",
  "interview_type": "technical",
  "difficulty": 3,
  "question_count": 2,
  "question_number": 1,
  "current_question": {
    "question_id": "q_technical-validation_3",
    "question_text": "How would you design a service that safely accepts and validates user input?",
    "skill_category": "technical_fundamentals",
    "difficulty": 3,
    "interview_type": "technical"
  }
}
```

Unknown session (`404 Not Found`):

```json
{
  "error": {
    "code": "session_not_found",
    "message": "No session exists for the supplied session_id."
  }
}
```

## Implemented lifecycle endpoint

### `POST /api/sessions/{id}/answers`

Accepts one answer for the current question. `transcript` is the canonical text
interface for Person 2; `audio_reference` is optional opaque metadata, not
uploaded audio. A non-empty transcript is required and is limited to 20,000
characters.

```json
{
  "question_id": "q_technical-validation_3",
  "transcript": "I would validate each request at the API boundary, return useful errors, log failures safely, and test every invalid case.",
  "audio_reference": "local-recording-001"
}
```

`200 OK` (non-final answer):

```json
{
  "session_id": "ses_8b1d4a3f5c3e4a18a8e07dbe3bdcfa4e",
  "question_id": "q_technical-validation_3",
  "answer_id": "ans_01",
  "status": "accepted",
  "session_status": "in_progress",
  "evaluation": {
    "evaluation_source": "mock_deterministic",
    "is_mock": true,
    "score": 70,
    "rubric": {
      "relevance": 72,
      "completeness": 65,
      "clarity": 72,
      "reasoning": 68,
      "technical_correctness": null,
      "concrete_details": 60
    },
    "strengths": ["Provided a relevant response with a clear starting point."],
    "improvements": ["Add more context, actions, and an outcome to strengthen the answer."],
    "feedback": "Mock evaluation: expand the example into a complete explanation."
  },
  "difficulty_adjustment": {
    "previous_difficulty": 3,
    "next_difficulty": 3,
    "decision": "maintain",
    "rationale": "The evaluation score is in the middle range, so the next question keeps the current difficulty.",
    "source": "evaluation"
  },
  "next_question": {
    "question_id": "q_technical-debugging_3",
    "question_text": "Walk me through how you would debug a slow API endpoint.",
    "skill_category": "problem_solving",
    "difficulty": 3,
    "interview_type": "technical"
  }
}
```

`evaluation_source: "mock_deterministic"` and `is_mock: true` are mandatory:
this is transparent placeholder feedback, not Gemini assessment. Gemini mode
returns `evaluation_source: "gemini"` and `is_mock: false` with the same
response schema. The rubric scores relevance, completeness, clarity, reasoning,
concrete supporting details, and technical correctness only when applicable;
it never scores delivery, vocal confidence, pace, or physiology.

The backend applies a bounded policy: score `>=80` increases the next question
one level unless at level 5; score `<=49` decreases one level unless at level
1; other scores maintain difficulty. The response includes the decision and
rationale. After the last answer, `session_status` is `"completed"` and
`next_question` is `null`.

Return `404 session_not_found` for an unknown session; `409 session_not_started`
before start, `409 session_completed` after completion, `409 question_not_current`
for an unknown/out-of-order question, and `409 question_already_answered` for a
duplicate. Invalid request fields return `422` with the shared error envelope.

## Implemented voice endpoints (P4.3)

ElevenLabs credentials remain server-only. The browser communicates only with
these FastAPI endpoints. Voice endpoints use the same error envelope as the
session API and do not create or change a session by themselves.

### `POST /api/voice/synthesize`

Accepts question text and returns MP3 audio (`Content-Type: audio/mpeg`). The
frontend should create an object URL from the response Blob and play it with an
`HTMLAudioElement`.

```json
{ "text": "Tell me about a time you received constructive feedback." }
```

Successful responses set `Cache-Control: no-store`. A missing server-side
ElevenLabs configuration returns `503 speech_not_configured`; an upstream TTS
failure returns `502 speech_synthesis_failed`.

### `POST /api/voice/transcribe`

Accepts a multipart upload with one `file` field and returns its recognized
text. Browser recording clients should prefer `audio/webm;codecs=opus` and may
fall back to MP4 or OGG. The backend also accepts MP3, WAV, Opus, and AAC.

```text
Content-Type: multipart/form-data
file: answer.webm (audio/webm)
```

```json
{ "transcript": "I would begin by validating the request at the API boundary." }
```

Each recording is processed in memory and must be non-empty and no larger than
25 MB. Recoverable errors include `415 unsupported_recording_format`, `422
empty_recording`, `413 recording_too_large`, `503 speech_not_configured`, and
`502 transcription_failed`. Submit the returned `transcript` unchanged to the
existing `POST /api/sessions/{id}/answers` endpoint with the current
`question_id`.

## Planned endpoints (not implemented in Milestone 1B)

### `POST /api/sessions/{id}/metrics`

Future append-only measurement events for Person 3:

```json
{
  "events": [
    {
      "event_id": "evt_01",
      "question_id": "q_technical-validation_3",
      "metric_type": "engagement_score",
      "value": 0.82,
      "unit": "ratio",
      "observed_at": "2026-10-10T15:04:05Z",
      "source": "presage"
    }
  ]
}
```

Proposed `202 Accepted`:

```json
{ "session_id": "ses_8b1d4a3f5c3e4a18a8e07dbe3bdcfa4e", "accepted_event_ids": ["evt_01"] }
```

Each event needs `event_id`, `metric_type`, numeric `value`, ISO-8601 UTC
`observed_at`, and `source`; `question_id` is optional for session-level data.
Proposed errors: `404` unknown session, `409` duplicate `event_id`, `422` invalid
event.

### `GET /api/sessions/{id}/report`

Future evaluation result for Person 3 and Person 4. Proposed `200 OK`:

```json
{
  "session_id": "ses_8b1d4a3f5c3e4a18a8e07dbe3bdcfa4e",
  "status": "completed",
  "overall_score": 78,
  "question_feedback": [
    {
      "question_id": "q_technical-validation_3",
      "score": 80,
      "strengths": ["Identified boundary validation."],
      "improvements": ["Give a concrete error-handling example."],
      "feedback": "A sound foundation; add implementation detail.",
      "skill_scores": { "technical_fundamentals": 80, "communication": 76 }
    }
  ],
  "metrics_summary": { "engagement_score": 0.82 }
}
```

All scores are integer `0..100`; `strengths` and `improvements` are string
arrays. Until ready, return `409` code `report_not_ready`; unknown session is
`404`.

### `POST /api/practice/questions/generate`

Planned frontend typing boundary only; it must **not** call Gemini in this
milestone.

```json
{ "interview_type": "behavioral", "difficulty": 2, "count": 2, "skill_categories": ["communication", "teamwork"] }
```

Proposed `200 OK`:

```json
{
  "questions": [
    {
      "question_id": "q_behavioral-feedback_2",
      "question_text": "Tell me about a time you received constructive feedback and how you used it.",
      "skill_category": "communication",
      "difficulty": 2,
      "interview_type": "behavioral"
    }
  ]
}
```

`count` is integer `1..10`; categories use the shared values. Return `422` for
invalid input and, after a provider exists, `503` code
`question_generation_unavailable` when it is unavailable.
