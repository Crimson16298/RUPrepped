# RUPrepped API contracts — proposal (Milestone 1B)

**Status:** proposed for teammate review, not a stable production API. The
Milestone 1B mock implements `GET /api/health`, `POST /api/sessions`,
`POST /api/sessions/{id}/start`, and `POST /api/sessions/{id}/answers`. It makes no calls to Gemini, ElevenLabs,
Presage, Tiger Data, authentication providers, or a database.

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

### `GET /api/health`

`200 OK`:

```json
{ "status": "ok", "service": "ruprepped-mock-backend" }
```

### `POST /api/sessions`

Creates an in-memory session and deterministically selects mock questions.
Questions are returned by `/start`, not this endpoint.

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
  "target_role_or_subject": "Backend software engineering intern"
}
```

Invalid input returns `422` with the error envelope.

### `POST /api/sessions/{id}/start`

Marks a `created` session `in_progress` and returns the first question. A
repeat call returns `409 session_already_started`.

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
    "strengths": ["Provided a relevant response with a clear starting point."],
    "improvements": ["Add more context, actions, and an outcome to strengthen the answer."],
    "feedback": "Mock evaluation: expand the example into a complete explanation."
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
this is transparent placeholder feedback, not Gemini assessment. After the
last answer, `session_status` is `"completed"` and `next_question` is `null`.

Return `404 session_not_found` for an unknown session; `409 session_not_started`
before start, `409 session_completed` after completion, `409 question_not_current`
for an unknown/out-of-order question, and `409 question_already_answered` for a
duplicate. Invalid request fields return `422` with the shared error envelope.

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
