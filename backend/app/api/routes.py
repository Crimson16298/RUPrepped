from fastapi import APIRouter, HTTPException, status

from app.database.store import InMemorySessionStore, SessionRecord
from app.schemas import (
    CreateSessionRequest,
    AnswerSubmissionRequest,
    AnswerSubmissionResponse,
    HealthResponse,
    SessionResponse,
    SessionStatus,
    StartSessionResponse,
)
from app.services.interview import build_questions
from app.services.session import LifecycleError, start, submit_answer

router = APIRouter(prefix="/api")
store = InMemorySessionStore()


def _session_response(record: SessionRecord) -> SessionResponse:
    return SessionResponse(
        session_id=record.session_id,
        status=record.status,
        interview_type=record.request.interview_type,
        difficulty=record.request.difficulty,
        question_count=record.request.question_count,
        target_role_or_subject=record.request.target_role_or_subject,
    )


@router.get("/health", response_model=HealthResponse, tags=["health"])
def health() -> HealthResponse:
    return HealthResponse(status="ok", service="ruprepped-mock-backend")


@router.post("/sessions", response_model=SessionResponse, status_code=status.HTTP_201_CREATED, tags=["sessions"])
def create_session(payload: CreateSessionRequest) -> SessionResponse:
    record = store.create(payload, build_questions(payload))
    return _session_response(record)


@router.post("/sessions/{session_id}/start", response_model=StartSessionResponse, tags=["sessions"])
def start_session(session_id: str) -> StartSessionResponse:
    record = store.get(session_id)
    if record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "session_not_found", "message": "No session exists for the supplied session_id."},
        )
    try:
        start(record)
    except LifecycleError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail={"code": exc.code, "message": exc.message}) from exc
    return StartSessionResponse(
        **_session_response(record).model_dump(),
        current_question=record.questions[0],
        question_number=1,
    )


@router.post("/sessions/{session_id}/answers", response_model=AnswerSubmissionResponse, tags=["sessions"])
def submit_session_answer(session_id: str, payload: AnswerSubmissionRequest) -> AnswerSubmissionResponse:
    record = store.get(session_id)
    if record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "session_not_found", "message": "No session exists for the supplied session_id."},
        )
    try:
        answer, next_question = submit_answer(record, payload)
    except LifecycleError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail={"code": exc.code, "message": exc.message}) from exc
    return AnswerSubmissionResponse(
        session_id=record.session_id,
        question_id=answer.question_id,
        answer_id=answer.answer_id,
        status="accepted",
        session_status=record.status,
        evaluation=answer.evaluation,
        next_question=next_question,
    )
