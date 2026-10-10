from __future__ import annotations

from dataclasses import dataclass, field
from uuid import uuid4

from app.schemas import AnswerEvaluation, CreateSessionRequest, Question, SessionStatus


@dataclass
class AnswerRecord:
    answer_id: str
    question_id: str
    transcript: str
    audio_reference: str | None
    evaluation: AnswerEvaluation


@dataclass
class SessionRecord:
    session_id: str
    request: CreateSessionRequest
    questions: list[Question]
    status: SessionStatus = SessionStatus.CREATED
    current_question_index: int = 0
    answers: list[AnswerRecord] = field(default_factory=list)


class InMemorySessionStore:
    """Process-local storage for the mock backend only."""

    def __init__(self) -> None:
        self._sessions: dict[str, SessionRecord] = {}

    def create(self, request: CreateSessionRequest, questions: list[Question]) -> SessionRecord:
        record = SessionRecord(session_id=f"ses_{uuid4().hex}", request=request, questions=questions)
        self._sessions[record.session_id] = record
        return record

    def get(self, session_id: str) -> SessionRecord | None:
        return self._sessions.get(session_id)

    def clear(self) -> None:
        self._sessions.clear()
