from fastapi.testclient import TestClient

from app.api import routes
from app.api.routes import store
from app.main import app

client = TestClient(app)


def setup_function() -> None:
    store.clear()


def test_health() -> None:
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "ruprepped-mock-backend"}


def test_react_development_origin_is_allowed() -> None:
    response = client.options(
        "/api/sessions",
        headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "POST"},
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"


def test_synthesize_question_audio_returns_playable_mp3(monkeypatch) -> None:
    monkeypatch.setattr(routes, "synthesize_speech", lambda text: b"mock-mp3:" + text.encode())

    response = client.post("/api/voice/synthesize", json={"text": "Please introduce yourself."})

    assert response.status_code == 200
    assert response.headers["content-type"] == "audio/mpeg"
    assert response.headers["cache-control"] == "no-store"
    assert response.content == b"mock-mp3:Please introduce yourself."


def test_transcribe_recording_returns_provider_transcript(monkeypatch) -> None:
    captured: dict[str, object] = {}

    def fake_transcribe(audio: bytes, *, filename: str) -> str:
        captured["audio"] = audio
        captured["filename"] = filename
        return "I would explain the trade-off first."

    monkeypatch.setattr(routes, "transcribe_audio", fake_transcribe)
    response = client.post(
        "/api/voice/transcribe",
        files={"file": ("answer.webm", b"webm-recording", "audio/webm")},
    )

    assert response.status_code == 200
    assert response.json() == {"transcript": "I would explain the trade-off first."}
    assert captured == {"audio": b"webm-recording", "filename": "answer.webm"}


def test_transcribe_recording_rejects_unsupported_format() -> None:
    response = client.post(
        "/api/voice/transcribe",
        files={"file": ("answer.txt", b"not-a-recording", "text/plain")},
    )

    assert response.status_code == 415
    assert response.json()["error"]["code"] == "unsupported_recording_format"


def test_create_then_start_session_returns_deterministic_question() -> None:
    create = client.post(
        "/api/sessions",
        json={"interview_type": "technical", "difficulty": 3, "question_count": 2},
    )
    assert create.status_code == 201
    created = create.json()
    assert created["session_id"].startswith("ses_")
    assert created["status"] == "created"

    start = client.post(f"/api/sessions/{created['session_id']}/start")
    assert start.status_code == 200
    body = start.json()
    assert body["status"] == "in_progress"
    assert body["question_number"] == 1
    assert body["current_question"] == {
        "question_id": "q_technical-validation_3",
        "question_text": "How would you design a service that safely accepts and validates user input?",
        "skill_category": "technical_fundamentals",
        "difficulty": 3,
        "interview_type": "technical",
    }


def test_create_session_accepts_optional_interview_context() -> None:
    response = client.post(
        "/api/sessions",
        json={
            "interview_type": "behavioral",
            "difficulty": 2,
            "question_count": 3,
            "target_role_or_subject": "Computer science",
            "job_description": "Practice interview for a software internship.",
            "resume_text": "Built a student project.",
        },
    )
    assert response.status_code == 201
    assert response.json()["target_role_or_subject"] == "Computer science"


def test_answer_returns_mock_evaluation_and_next_question() -> None:
    created = client.post("/api/sessions", json={"interview_type": "technical", "question_count": 3}).json()
    started = client.post(f"/api/sessions/{created['session_id']}/start").json()

    response = client.post(
        f"/api/sessions/{created['session_id']}/answers",
        json={
            "question_id": started["current_question"]["question_id"],
            "transcript": "I would validate input at the API boundary, return useful errors, and test invalid cases.",
            "audio_reference": "elevenlabs-turn-1",
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["answer_id"] == "ans_01"
    assert body["session_status"] == "in_progress"
    assert body["evaluation"]["evaluation_source"] == "mock_deterministic"
    assert body["evaluation"]["is_mock"] is True
    assert body["next_question"]["question_id"] == "q_technical-debugging_2"


def test_full_three_question_interview_completes_and_preserves_history() -> None:
    created = client.post("/api/sessions", json={"interview_type": "behavioral", "question_count": 3}).json()
    session_id = created["session_id"]
    question = client.post(f"/api/sessions/{session_id}/start").json()["current_question"]

    for number in range(1, 4):
        response = client.post(
            f"/api/sessions/{session_id}/answers",
            json={"question_id": question["question_id"], "transcript": f"This is my detailed answer number {number} with context and outcome."},
        )
        assert response.status_code == 200
        body = response.json()
        if number < 3:
            assert body["session_status"] == "in_progress"
            question = body["next_question"]
        else:
            assert body["session_status"] == "completed"
            assert body["next_question"] is None

    record = store.get(session_id)
    assert record is not None
    assert len(record.answers) == 3
    assert [answer.answer_id for answer in record.answers] == ["ans_01", "ans_02", "ans_03"]


def test_answer_state_machine_rejects_invalid_transitions() -> None:
    created = client.post("/api/sessions", json={"interview_type": "technical", "question_count": 1}).json()
    session_id = created["session_id"]
    question_id = "q_technical-validation_2"

    before_start = client.post(f"/api/sessions/{session_id}/answers", json={"question_id": question_id, "transcript": "answer"})
    assert before_start.status_code == 409
    assert before_start.json()["error"]["code"] == "session_not_started"

    started = client.post(f"/api/sessions/{session_id}/start")
    assert started.status_code == 200
    repeat_start = client.post(f"/api/sessions/{session_id}/start")
    assert repeat_start.status_code == 409
    assert repeat_start.json()["error"]["code"] == "session_already_started"

    unknown_question = client.post(f"/api/sessions/{session_id}/answers", json={"question_id": "q_unknown", "transcript": "answer"})
    assert unknown_question.status_code == 409
    assert unknown_question.json()["error"]["code"] == "question_not_current"

    accepted = client.post(f"/api/sessions/{session_id}/answers", json={"question_id": question_id, "transcript": "answer"})
    assert accepted.status_code == 200
    after_completion = client.post(f"/api/sessions/{session_id}/answers", json={"question_id": question_id, "transcript": "answer"})
    assert after_completion.status_code == 409
    assert after_completion.json()["error"]["code"] == "session_completed"


def test_duplicate_answer_and_invalid_answer_are_rejected() -> None:
    created = client.post("/api/sessions", json={"interview_type": "technical", "question_count": 2}).json()
    session_id = created["session_id"]
    first_question = client.post(f"/api/sessions/{session_id}/start").json()["current_question"]["question_id"]
    assert client.post(f"/api/sessions/{session_id}/answers", json={"question_id": first_question, "transcript": "answer"}).status_code == 200

    duplicate = client.post(f"/api/sessions/{session_id}/answers", json={"question_id": first_question, "transcript": "answer again"})
    assert duplicate.status_code == 409
    assert duplicate.json()["error"]["code"] == "question_already_answered"

    invalid = client.post(f"/api/sessions/{session_id}/answers", json={"question_id": "q_technical-debugging_2", "transcript": "   "})
    assert invalid.status_code == 422
    assert invalid.json()["error"]["code"] == "validation_error"


def test_invalid_difficulty_uses_contract_error_shape() -> None:
    response = client.post("/api/sessions", json={"interview_type": "behavioral", "difficulty": 6})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"
    assert "difficulty" in response.json()["error"]["fields"]


def test_unknown_session_is_not_found() -> None:
    response = client.post("/api/sessions/ses_missing/start")
    assert response.status_code == 404
    assert response.json() == {
        "error": {"code": "session_not_found", "message": "No session exists for the supplied session_id."}
    }
