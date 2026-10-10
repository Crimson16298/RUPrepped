from __future__ import annotations

from enum import Enum
from typing import Annotated, Literal

from pydantic import BaseModel, Field, field_validator


class InterviewType(str, Enum):
    BEHAVIORAL = "behavioral"
    TECHNICAL = "technical"
    MIXED = "mixed"


class SessionStatus(str, Enum):
    CREATED = "created"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"


class SkillCategory(str, Enum):
    COMMUNICATION = "communication"
    PROBLEM_SOLVING = "problem_solving"
    TEAMWORK = "teamwork"
    TECHNICAL_FUNDAMENTALS = "technical_fundamentals"


Difficulty = Annotated[int, Field(ge=1, le=5)]


class CreateSessionRequest(BaseModel):
    interview_type: InterviewType
    difficulty: Difficulty = 2
    question_count: Annotated[int, Field(ge=1, le=10)] = 3
    target_role_or_subject: Annotated[str | None, Field(min_length=1, max_length=200)] = None
    job_description: Annotated[str | None, Field(min_length=1, max_length=10_000)] = None
    resume_text: Annotated[str | None, Field(min_length=1, max_length=20_000)] = None


class Question(BaseModel):
    question_id: str
    question_text: str
    skill_category: SkillCategory
    difficulty: Difficulty
    interview_type: InterviewType


class SessionResponse(BaseModel):
    session_id: str
    status: SessionStatus
    interview_type: InterviewType
    difficulty: Difficulty
    question_count: int
    target_role_or_subject: str | None = None


class StartSessionResponse(SessionResponse):
    current_question: Question
    question_number: int


class AnswerSubmissionRequest(BaseModel):
    question_id: Annotated[str, Field(min_length=1)]
    transcript: Annotated[str, Field(min_length=1, max_length=20_000)]
    audio_reference: Annotated[str | None, Field(min_length=1, max_length=500)] = None

    @field_validator("transcript")
    @classmethod
    def transcript_must_contain_text(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Transcript must contain non-whitespace text.")
        return value.strip()


class AnswerEvaluation(BaseModel):
    evaluation_source: Literal["mock_deterministic"]
    is_mock: Literal[True]
    score: Annotated[int, Field(ge=0, le=100)]
    strengths: list[str]
    improvements: list[str]
    feedback: str


class AnswerSubmissionResponse(BaseModel):
    session_id: str
    question_id: str
    answer_id: str
    status: Literal["accepted"]
    session_status: SessionStatus
    evaluation: AnswerEvaluation
    next_question: Question | None = None


class HealthResponse(BaseModel):
    status: Literal["ok"]
    service: Literal["ruprepped-mock-backend"]


class ErrorDetail(BaseModel):
    code: str
    message: str
    fields: dict[str, str] | None = None


class ErrorResponse(BaseModel):
    error: ErrorDetail
