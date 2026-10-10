from __future__ import annotations

import json
import socket
import ssl
import time
from typing import Any

import httpx
from pydantic import BaseModel, Field, ValidationError

from app.database.store import AnswerRecord
from app.schemas import AnswerEvaluation, CreateSessionRequest, ProviderMode, RubricScores, SkillCategory, Question
from app.services.interview import GeneratedQuestion
from app.services.prompts import build_evaluation_prompt, build_question_prompt


class GeminiQuestionOutput(BaseModel):
    question_text: str = Field(min_length=1, max_length=2_000)
    skill_category: SkillCategory


class GeminiEvaluationOutput(BaseModel):
    score: int = Field(ge=0, le=100)
    rubric: RubricScores
    strengths: list[str] = Field(min_length=1, max_length=5)
    improvements: list[str] = Field(min_length=1, max_length=5)
    feedback: str = Field(min_length=1, max_length=1_000)


class GeminiInterviewProvider:
    """Official Google GenAI SDK adapter; it returns validated domain models only."""

    mode = ProviderMode.GEMINI

    def __init__(self, api_key: str, model: str, timeout_ms: int, client: Any | None = None) -> None:
        self.model = model
        if client is not None:
            self.client = client
            return
        try:
            from google import genai
            from google.genai import types
        except ImportError as exc:
            from app.services.providers import ProviderConfigurationError

            raise ProviderConfigurationError("The google-genai package is not installed.") from exc
        self.client = genai.Client(
            api_key=api_key,
            http_options=types.HttpOptions(timeout=timeout_ms, retry_options=types.HttpRetryOptions(attempts=1)),
        )

    @staticmethod
    def _provider_error(exc: Exception, operation: str, elapsed_ms: int):
        from google.genai import errors
        from app.services.providers import (
            ProviderAuthenticationError,
            ProviderNetworkError,
            ProviderRateLimitError,
            ProviderRequestError,
            ProviderServerError,
            ProviderTimeoutError,
            ProviderUnavailableError,
            ProviderModelError,
        )

        details = {"operation": operation, "exception_class": type(exc).__name__, "elapsed_ms": elapsed_ms}
        if isinstance(exc, errors.APIError):
            provider_status = exc.code or 0
            details["provider_status"] = provider_status
            if provider_status == 400:
                return ProviderRequestError("Gemini rejected the request configuration.", **details)
            if provider_status in {401, 403}:
                return ProviderAuthenticationError("Gemini rejected the configured credentials or permissions.", **details)
            if provider_status == 404:
                return ProviderModelError("The configured Gemini model is unavailable.", **details)
            if provider_status == 429:
                return ProviderRateLimitError("Gemini rate limit or quota was reached.", **details)
            if provider_status >= 500:
                return ProviderServerError("Gemini returned a server error.", **details)
            return ProviderUnavailableError("Gemini returned an unexpected API error.", **details)
        if isinstance(exc, (httpx.TimeoutException, TimeoutError)):
            return ProviderTimeoutError("Gemini request timed out.", **details)
        if isinstance(exc, (httpx.TransportError, socket.gaierror, ssl.SSLError, ConnectionError)):
            return ProviderNetworkError("Gemini network transport failed.", **details)
        return ProviderUnavailableError("Gemini request failed before a response was available.", **details)

    def _structured_call(self, prompt: str, schema: type[BaseModel]) -> BaseModel:
        operation = "generate_question" if schema is GeminiQuestionOutput else "evaluate_answer"
        started_at = time.perf_counter()
        try:
            response = self.client.models.generate_content(
                model=self.model,
                contents=prompt,
                config={"response_mime_type": "application/json", "response_schema": schema},
            )
        except Exception as exc:
            elapsed_ms = round((time.perf_counter() - started_at) * 1000)
            raise self._provider_error(exc, operation, elapsed_ms) from exc
        try:
            parsed = getattr(response, "parsed", None)
            if parsed is not None:
                return schema.model_validate(parsed)
            return schema.model_validate_json(response.text)
        except (AttributeError, ValidationError, ValueError, TypeError, json.JSONDecodeError) as exc:
            from app.services.providers import ProviderResponseError

            elapsed_ms = round((time.perf_counter() - started_at) * 1000)
            raise ProviderResponseError(
                "Gemini returned a response that did not match the required schema.",
                operation=operation,
                exception_class=type(exc).__name__,
                elapsed_ms=elapsed_ms,
            ) from exc

    def generate_question(self, request: CreateSessionRequest, questions: list[Question], answers: list[AnswerRecord], difficulty: int) -> GeneratedQuestion:
        output = self._structured_call(build_question_prompt(request, questions, answers, difficulty), GeminiQuestionOutput)
        assert isinstance(output, GeminiQuestionOutput)
        if output.question_text.strip() in {question.question_text.strip() for question in questions}:
            from app.services.providers import ProviderResponseError

            raise ProviderResponseError("Gemini generated a duplicate interview question.")
        return GeneratedQuestion(question_text=output.question_text.strip(), skill_category=output.skill_category)

    def evaluate_answer(self, request: CreateSessionRequest, question: Question, transcript: str, questions: list[Question], answers: list[AnswerRecord]) -> AnswerEvaluation:
        output = self._structured_call(build_evaluation_prompt(request, question, transcript, questions, answers), GeminiEvaluationOutput)
        assert isinstance(output, GeminiEvaluationOutput)
        return AnswerEvaluation(evaluation_source="gemini", is_mock=False, **output.model_dump())
