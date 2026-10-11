from types import SimpleNamespace

import httpx
import pytest
from google.genai import errors as genai_errors

from app.api.routes import store
from app.config import get_settings
from app.database.store import InMemorySessionStore
from app.main import app
from app.schemas import AnswerEvaluation, AnswerSubmissionRequest, CreateSessionRequest, ProviderMode, Question, RubricScores, SkillCategory, SessionStatus
from app.services.gemini import GeminiInterviewProvider
from app.services.interview import GeneratedQuestion, build_mock_question
from app.services.policy import choose_next_difficulty
from app.services.providers import (
    ProviderAuthenticationError,
    ProviderConfigurationError,
    ProviderModelError,
    ProviderNetworkError,
    ProviderRateLimitError,
    ProviderRequestError,
    ProviderResponseError,
    ProviderServerError,
    ProviderTimeoutError,
    ProviderUnavailableError,
    create_provider,
)
from app.services.session import start, submit_answer


class FakeModels:
    def __init__(self, responses: list[object] | None = None, error: Exception | None = None) -> None:
        self.responses = responses or []
        self.error = error
        self.calls: list[dict[str, object]] = []

    def generate_content(self, **kwargs: object) -> object:
        self.calls.append(kwargs)
        if self.error:
            raise self.error
        return self.responses.pop(0)


class FakeClient:
    def __init__(self, models: FakeModels) -> None:
        self.models = models


def _request() -> CreateSessionRequest:
    return CreateSessionRequest(
        interview_type="technical",
        difficulty=3,
        target_role_or_subject="Backend intern",
        job_description="Build reliable API services.",
        resume_text="Built FastAPI applications.",
    )


def _question() -> Question:
    return Question(
        question_id="q_1",
        question_text="How would you design an idempotent API endpoint?",
        skill_category=SkillCategory.TECHNICAL_FUNDAMENTALS,
        difficulty=3,
        interview_type="technical",
    )


def _evaluation_payload(score: int = 82) -> dict[str, object]:
    return {
        "score": score,
        "rubric": {"relevance": 85, "completeness": 80, "clarity": 82, "reasoning": 84, "technical_correctness": 80, "concrete_details": 76},
        "strengths": ["Explained an appropriate design."],
        "improvements": ["Name one concrete persistence strategy."],
        "feedback": "Strong answer with room for implementation detail.",
    }


def test_gemini_provider_parses_structured_question_and_personalizes_prompt() -> None:
    models = FakeModels([SimpleNamespace(parsed={"question_text": "For a backend intern role, how would you make a write endpoint idempotent?", "skill_category": "technical_fundamentals"})])
    provider = GeminiInterviewProvider(api_key="test", model="test-model", timeout_ms=1000, client=FakeClient(models))

    generated = provider.generate_question(_request(), [_question()], [], 4)

    assert generated.skill_category is SkillCategory.TECHNICAL_FUNDAMENTALS
    assert "idempotent" in generated.question_text
    prompt = models.calls[0]["contents"]
    assert "Backend intern" in prompt
    assert "Build reliable API services." in prompt
    assert "Built FastAPI applications." in prompt
    assert "Target difficulty (1-5): 4" in prompt
    assert "How would you design an idempotent API endpoint?" in prompt


def test_gemini_provider_parses_structured_evaluation() -> None:
    models = FakeModels([SimpleNamespace(parsed=_evaluation_payload())])
    provider = GeminiInterviewProvider(api_key="test", model="test-model", timeout_ms=1000, client=FakeClient(models))

    evaluation = provider.evaluate_answer(_request(), _question(), "I would use an idempotency key and persist the result.", [_question()], [])

    assert evaluation.evaluation_source == "gemini"
    assert evaluation.is_mock is False
    assert evaluation.score == 82
    assert evaluation.rubric.technical_correctness == 80
    assert "text-only" in models.calls[0]["contents"]


def test_gemini_provider_rejects_malformed_structured_response() -> None:
    models = FakeModels([SimpleNamespace(parsed=None, text='{"question_text": 9}')])
    provider = GeminiInterviewProvider(api_key="test", model="test-model", timeout_ms=1000, client=FakeClient(models))

    with pytest.raises(ProviderResponseError):
        provider.generate_question(_request(), [], [], 3)


def test_gemini_provider_does_not_fall_back_after_network_error() -> None:
    provider = GeminiInterviewProvider(api_key="test", model="test-model", timeout_ms=1000, client=FakeClient(FakeModels(error=OSError("network unavailable"))))

    with pytest.raises(ProviderUnavailableError):
        provider.generate_question(_request(), [], [], 3)


@pytest.mark.parametrize(
    ("upstream_status", "expected_error", "expected_response_status"),
    [
        (400, ProviderRequestError, 502),
        (401, ProviderAuthenticationError, 503),
        (403, ProviderAuthenticationError, 503),
        (404, ProviderModelError, 503),
        (429, ProviderRateLimitError, 503),
        (500, ProviderServerError, 503),
    ],
)
def test_gemini_http_failures_are_classified_without_exposing_response_body(upstream_status: int, expected_error: type[Exception], expected_response_status: int) -> None:
    sdk_error = genai_errors.ClientError(upstream_status, {"error": {"message": "sensitive upstream body", "status": "TEST"}})
    provider = GeminiInterviewProvider(api_key="test", model="test-model", timeout_ms=1000, client=FakeClient(FakeModels(error=sdk_error)))

    with pytest.raises(expected_error) as caught:
        provider.generate_question(_request(), [], [], 3)
    error = caught.value
    assert error.provider_status == upstream_status
    assert error.response_status == expected_response_status
    assert "sensitive upstream body" not in str(error)
    assert error.operation == "generate_question"
    assert error.elapsed_ms is not None


def test_gemini_timeout_and_network_failures_are_classified() -> None:
    timeout_provider = GeminiInterviewProvider(api_key="test", model="test-model", timeout_ms=1000, client=FakeClient(FakeModels(error=httpx.ReadTimeout("slow"))))
    with pytest.raises(ProviderTimeoutError) as timeout:
        timeout_provider.generate_question(_request(), [], [], 3)
    assert timeout.value.response_status == 504

    network_provider = GeminiInterviewProvider(api_key="test", model="test-model", timeout_ms=1000, client=FakeClient(FakeModels(error=httpx.ConnectError("dns"))))
    with pytest.raises(ProviderNetworkError) as network:
        network_provider.generate_question(_request(), [], [], 3)
    assert network.value.response_status == 503


def test_mock_mode_is_explicit_and_gemini_requires_server_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("INTERVIEW_PROVIDER", "mock")
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    assert create_provider().mode.value == "mock"

    monkeypatch.setenv("INTERVIEW_PROVIDER", "gemini")
    with pytest.raises(ProviderConfigurationError):
        create_provider()


def test_default_gemini_model_is_live_verified_model(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("GEMINI_MODEL", raising=False)

    assert get_settings().gemini_model == "gemini-3.5-flash-lite"


def test_adaptation_policy_respects_boundaries() -> None:
    high = AnswerEvaluation(evaluation_source="gemini", is_mock=False, score=90, rubric=RubricScores(relevance=90, completeness=90, clarity=90, reasoning=90, concrete_details=90), strengths=["x"], improvements=["y"], feedback="z")
    low = high.model_copy(update={"score": 30})
    middle = high.model_copy(update={"score": 65})

    assert choose_next_difficulty(4, high).next_difficulty == 5
    capped = choose_next_difficulty(5, high)
    assert capped.decision == "maintain" and capped.next_difficulty == 5
    assert choose_next_difficulty(2, low).next_difficulty == 1
    floored = choose_next_difficulty(1, low)
    assert floored.decision == "maintain" and floored.next_difficulty == 1
    assert choose_next_difficulty(3, middle).decision == "maintain"


def test_mock_question_ids_remain_unique_beyond_three_questions() -> None:
    request = _request()
    questions: list[Question] = []
    for _ in range(5):
        question = build_mock_question(request, questions, 3)
        questions.append(question)
    assert len({question.question_id for question in questions}) == 5


def test_five_question_mock_session_keeps_unique_question_ids() -> None:
    from fastapi.testclient import TestClient

    store.clear()
    client = TestClient(app)
    created = client.post("/api/sessions", json={"interview_type": "technical", "difficulty": 2, "question_count": 5}).json()
    session_id = created["session_id"]
    question = client.post(f"/api/sessions/{session_id}/start").json()["current_question"]
    question_ids = [question["question_id"]]
    for _ in range(5):
        response = client.post(
            f"/api/sessions/{session_id}/answers",
            json={"question_id": question["question_id"], "transcript": "I would explain the context, actions, tradeoffs, technical reasoning, and measurable outcome in enough detail for this interview answer."},
        )
        assert response.status_code == 200
        next_question = response.json()["next_question"]
        if next_question:
            question = next_question
            question_ids.append(question["question_id"])
    assert len(question_ids) == 5
    assert len(set(question_ids)) == 5


def test_gemini_mode_without_key_returns_explicit_api_error(monkeypatch: pytest.MonkeyPatch) -> None:
    from fastapi.testclient import TestClient

    store.clear()
    monkeypatch.setenv("INTERVIEW_PROVIDER", "gemini")
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    response = TestClient(app).post("/api/sessions", json={"interview_type": "technical"})
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "provider_not_configured"


class FollowUpFailureProvider:
    mode = ProviderMode.GEMINI

    def __init__(self) -> None:
        self.fail_follow_up = True

    def generate_question(self, request: CreateSessionRequest, questions: list[Question], answers: list[object], difficulty: int) -> GeneratedQuestion:
        if questions and self.fail_follow_up:
            raise ProviderUnavailableError("Gemini could not be reached within the configured timeout.")
        return GeneratedQuestion(question_text="How would you explain idempotency?", skill_category=SkillCategory.TECHNICAL_FUNDAMENTALS)

    def evaluate_answer(self, request: CreateSessionRequest, question: Question, transcript: str, questions: list[Question], answers: list[object]) -> AnswerEvaluation:
        return AnswerEvaluation(evaluation_source="gemini", is_mock=False, score=82, rubric=RubricScores(relevance=82, completeness=80, clarity=82, reasoning=82, concrete_details=78), strengths=["Relevant answer."], improvements=["Add one implementation detail."], feedback="Good reasoning.")


def test_provider_failure_does_not_corrupt_session_or_duplicate_retry() -> None:
    record = InMemorySessionStore().create(_request(), ProviderMode.GEMINI)
    provider = FollowUpFailureProvider()
    question = start(record, provider)
    assert record.status is SessionStatus.IN_PROGRESS
    payload = AnswerSubmissionRequest(question_id=question.question_id, transcript="I would use a request key and return the stored result for duplicate requests.")

    with pytest.raises(ProviderUnavailableError):
        submit_answer(record, payload, provider)
    assert record.status is SessionStatus.IN_PROGRESS
    assert record.current_question_index == 0
    assert record.answers == []
    assert len(record.questions) == 1

    provider.fail_follow_up = False
    answer, next_question = submit_answer(record, payload, provider)
    assert answer.answer_id == "ans_01"
    assert len(record.answers) == 1
    assert next_question is not None
    assert len({item.question_id for item in record.questions}) == 2


def test_provider_failure_uses_error_envelope_and_preserves_created_session(monkeypatch: pytest.MonkeyPatch) -> None:
    from fastapi.testclient import TestClient
    from app.api import routes

    store.clear()
    client = TestClient(app)
    created = client.post("/api/sessions", json={"interview_type": "technical"}).json()

    def unavailable(_: ProviderMode) -> object:
        raise ProviderUnavailableError("Gemini could not be reached within the configured timeout.")

    monkeypatch.setattr(routes, "create_provider", unavailable)
    response = client.post(f"/api/sessions/{created['session_id']}/start")
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "provider_unavailable"
    record = store.get(created["session_id"])
    assert record is not None
    assert record.status is SessionStatus.CREATED
    assert record.questions == []


class RouteGeminiProvider:
    """No-network Gemini stand-in for HTTP integration tests."""

    mode = ProviderMode.GEMINI

    def generate_question(self, request: CreateSessionRequest, questions: list[Question], answers: list[object], difficulty: int) -> GeneratedQuestion:
        return GeneratedQuestion(question_text=f"How would you design a reliable API at level {difficulty}?", skill_category=SkillCategory.TECHNICAL_FUNDAMENTALS)

    def evaluate_answer(self, request: CreateSessionRequest, question: Question, transcript: str, questions: list[Question], answers: list[object]) -> AnswerEvaluation:
        return AnswerEvaluation(evaluation_source="gemini", is_mock=False, score=82, rubric=RubricScores(relevance=85, completeness=80, clarity=82, reasoning=84, technical_correctness=80, concrete_details=76), strengths=["Relevant technical approach."], improvements=["Name a persistence tradeoff."], feedback="Strong technical explanation.")


def test_fastapi_gemini_mode_create_start_and_answer_with_mocked_provider(monkeypatch: pytest.MonkeyPatch) -> None:
    from fastapi.testclient import TestClient
    from app.api import routes

    store.clear()
    provider = RouteGeminiProvider()
    monkeypatch.setenv("INTERVIEW_PROVIDER", "gemini")
    monkeypatch.setattr(routes, "create_provider", lambda mode=None: provider)
    client = TestClient(app)

    created = client.post("/api/sessions", json={"interview_type": "technical", "difficulty": 3, "question_count": 1})
    assert created.status_code == 201
    assert created.json()["provider_mode"] == "gemini"
    session_id = created.json()["session_id"]

    started = client.post(f"/api/sessions/{session_id}/start")
    assert started.status_code == 200
    assert started.json()["current_question"]["question_text"] == "How would you design a reliable API at level 3?"

    answered = client.post(f"/api/sessions/{session_id}/answers", json={"question_id": started.json()["current_question"]["question_id"], "transcript": "I would validate inputs, persist idempotency keys, and add retry-safe tests."})
    assert answered.status_code == 200
    assert answered.json()["evaluation"]["evaluation_source"] == "gemini"
    assert answered.json()["evaluation"]["is_mock"] is False
    assert answered.json()["session_status"] == "completed"


def test_fastapi_mock_mode_create_start_and_answer_flow(monkeypatch: pytest.MonkeyPatch) -> None:
    from fastapi.testclient import TestClient

    store.clear()
    monkeypatch.setenv("INTERVIEW_PROVIDER", "mock")
    client = TestClient(app)
    created = client.post("/api/sessions", json={"interview_type": "technical", "question_count": 1})
    assert created.status_code == 201
    assert created.json()["provider_mode"] == "mock"
    started = client.post(f"/api/sessions/{created.json()['session_id']}/start")
    assert started.status_code == 200
    answered = client.post(f"/api/sessions/{created.json()['session_id']}/answers", json={"question_id": started.json()["current_question"]["question_id"], "transcript": "A valid answer."})
    assert answered.status_code == 200
    assert answered.json()["evaluation"]["evaluation_source"] == "mock_deterministic"


def test_fastapi_rate_limit_response_keeps_safe_provider_diagnostics(monkeypatch: pytest.MonkeyPatch) -> None:
    from fastapi.testclient import TestClient
    from app.api import routes

    class RateLimitedProvider(RouteGeminiProvider):
        def generate_question(self, *args: object, **kwargs: object) -> GeneratedQuestion:
            raise ProviderRateLimitError("Gemini rate limit or quota was reached.", operation="generate_question", exception_class="ClientError", provider_status=429, elapsed_ms=12)

    store.clear()
    monkeypatch.setattr(routes, "create_provider", lambda mode=None: RateLimitedProvider())
    client = TestClient(app)
    session = client.post("/api/sessions", json={"interview_type": "technical"}).json()
    response = client.post(f"/api/sessions/{session['session_id']}/start")
    assert response.status_code == 503
    assert response.json()["error"] == {
        "code": "provider_rate_limited",
        "message": "Gemini rate limit or quota was reached.",
        "provider": {"operation": "generate_question", "exception_class": "ClientError", "provider_status": 429, "elapsed_ms": 12},
    }
