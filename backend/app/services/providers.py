from __future__ import annotations

from app.config import get_settings
from app.database.store import AnswerRecord
from app.schemas import AnswerEvaluation, CreateSessionRequest, ProviderMode, Question
from app.services.evaluation import evaluate_transcript
from app.services.gemini import GeminiInterviewProvider
from app.services.interview import GeneratedQuestion, InterviewProvider, build_mock_question


class ProviderError(Exception):
    code = "provider_unavailable"
    response_status = 503

    def __init__(
        self,
        message: str,
        *,
        operation: str = "provider_request",
        exception_class: str | None = None,
        provider_status: int | None = None,
        elapsed_ms: int | None = None,
    ) -> None:
        super().__init__(message)
        self.operation = operation
        self.exception_class = exception_class
        self.provider_status = provider_status
        self.elapsed_ms = elapsed_ms

    def detail(self) -> dict[str, object]:
        diagnostic: dict[str, object] = {"operation": self.operation}
        if self.exception_class:
            diagnostic["exception_class"] = self.exception_class
        if self.provider_status is not None:
            diagnostic["provider_status"] = self.provider_status
        if self.elapsed_ms is not None:
            diagnostic["elapsed_ms"] = self.elapsed_ms
        return {"code": self.code, "message": str(self), "provider": diagnostic}


class ProviderConfigurationError(ProviderError):
    code = "provider_not_configured"


class ProviderUnavailableError(ProviderError):
    code = "provider_unavailable"


class ProviderResponseError(ProviderError):
    code = "provider_invalid_response"
    response_status = 502


class ProviderRequestError(ProviderError):
    code = "provider_request_invalid"
    response_status = 502


class ProviderAuthenticationError(ProviderError):
    code = "provider_authentication_failed"


class ProviderModelError(ProviderError):
    code = "provider_model_unavailable"


class ProviderRateLimitError(ProviderError):
    code = "provider_rate_limited"


class ProviderServerError(ProviderError):
    code = "provider_server_error"


class ProviderTimeoutError(ProviderError):
    code = "provider_timeout"
    response_status = 504


class ProviderNetworkError(ProviderError):
    code = "provider_network_error"


class MockInterviewProvider:
    mode = ProviderMode.MOCK

    def generate_question(self, request: CreateSessionRequest, questions: list[Question], answers: list[AnswerRecord], difficulty: int) -> GeneratedQuestion:
        question = build_mock_question(request, questions, difficulty)
        return GeneratedQuestion(question_text=question.question_text, skill_category=question.skill_category, question_id_hint=question.question_id)

    def evaluate_answer(self, request: CreateSessionRequest, question: Question, transcript: str, questions: list[Question], answers: list[AnswerRecord]) -> AnswerEvaluation:
        return evaluate_transcript(transcript)


def create_provider(mode: ProviderMode | None = None) -> InterviewProvider:
    settings = get_settings()
    selected_mode = mode or settings.provider_mode
    if selected_mode is ProviderMode.MOCK:
        return MockInterviewProvider()
    if not settings.gemini_api_key:
        raise ProviderConfigurationError("GEMINI_API_KEY is required when INTERVIEW_PROVIDER=gemini.")
    return GeminiInterviewProvider(api_key=settings.gemini_api_key, model=settings.gemini_model, timeout_ms=settings.gemini_timeout_ms)
