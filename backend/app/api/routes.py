from fastapi import APIRouter, File, HTTPException, UploadFile, status
from fastapi.responses import Response

from app.database.store import InMemorySessionStore, SessionRecord
from app.schemas import (
    CreateSessionRequest,
    AnswerSubmissionRequest,
    AnswerSubmissionResponse,
    HealthResponse,
    SessionResponse,
    SpeechSynthesisRequest,
    StartSessionResponse,
    TranscriptionResponse,
)
from app.services.providers import ProviderError, create_provider
from app.services.session import LifecycleError, start, submit_answer
from app.services.speech import (
    SpeechConfigurationError,
    SpeechSynthesisError,
    SpeechTranscriptionError,
    synthesize_speech,
    transcribe_audio,
)

router = APIRouter(prefix="/api")
store = InMemorySessionStore()

SUPPORTED_RECORDING_MEDIA_TYPES = frozenset(
    {
        "audio/webm",
        "audio/ogg",
        "audio/mp4",
        "audio/mpeg",
        "audio/mp3",
        "audio/wav",
        "audio/x-wav",
        "audio/opus",
        "audio/aac",
    }
)
MAX_RECORDING_BYTES = 25 * 1024 * 1024


def _session_response(record: SessionRecord) -> SessionResponse:
    return SessionResponse(
        session_id=record.session_id,
        status=record.status,
        interview_type=record.request.interview_type,
        difficulty=record.request.difficulty,
        question_count=record.request.question_count,
        target_role_or_subject=record.request.target_role_or_subject,
        provider_mode=record.provider_mode,
    )


def _provider_error(exc: ProviderError) -> HTTPException:
    return HTTPException(status_code=exc.response_status, detail=exc.detail())


@router.get("/health", response_model=HealthResponse, tags=["health"])
def health() -> HealthResponse:
    return HealthResponse(status="ok", service="ruprepped-mock-backend")


@router.post("/voice/synthesize", response_class=Response, tags=["voice"])
def synthesize_question_audio(payload: SpeechSynthesisRequest) -> Response:
    """Generate a playable MP3 for the current interview question."""
    try:
        audio = synthesize_speech(payload.text)
    except SpeechConfigurationError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"code": "speech_not_configured", "message": str(exc)},
        ) from exc
    except SpeechSynthesisError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={"code": "speech_synthesis_failed", "message": str(exc)},
        ) from exc

    return Response(
        content=audio,
        media_type="audio/mpeg",
        headers={"Cache-Control": "no-store"},
    )


@router.post("/voice/transcribe", response_model=TranscriptionResponse, tags=["voice"])
async def transcribe_recorded_answer(file: UploadFile = File(...)) -> TranscriptionResponse:
    """Transcribe one browser-recorded candidate answer with ElevenLabs Scribe."""
    media_type = (file.content_type or "").split(";", maxsplit=1)[0].lower()
    if media_type not in SUPPORTED_RECORDING_MEDIA_TYPES:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail={
                "code": "unsupported_recording_format",
                "message": "Upload a WebM, OGG, MP4, MP3, WAV, Opus, or AAC audio recording.",
            },
        )

    try:
        audio = await file.read()
    finally:
        await file.close()

    if not audio:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "empty_recording", "message": "The recorded audio file is empty."},
        )
    if len(audio) > MAX_RECORDING_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail={"code": "recording_too_large", "message": "Keep a single recorded answer under 25 MB."},
        )

    try:
        transcript = transcribe_audio(audio, filename=file.filename or "answer.webm")
    except SpeechConfigurationError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"code": "speech_not_configured", "message": str(exc)},
        ) from exc
    except SpeechTranscriptionError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={"code": "transcription_failed", "message": str(exc)},
        ) from exc

    return TranscriptionResponse(transcript=transcript)


@router.post("/sessions", response_model=SessionResponse, status_code=status.HTTP_201_CREATED, tags=["sessions"])
def create_session(payload: CreateSessionRequest) -> SessionResponse:
    try:
        provider = create_provider()
    except ProviderError as exc:
        raise _provider_error(exc) from exc
    record = store.create(payload, provider.mode)
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
        current_question = start(record, create_provider(record.provider_mode))
    except LifecycleError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail={"code": exc.code, "message": exc.message}) from exc
    except ProviderError as exc:
        raise _provider_error(exc) from exc
    return StartSessionResponse(
        **_session_response(record).model_dump(),
        current_question=current_question,
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
        answer, next_question = submit_answer(record, payload, create_provider(record.provider_mode))
    except LifecycleError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail={"code": exc.code, "message": exc.message}) from exc
    except ProviderError as exc:
        raise _provider_error(exc) from exc
    return AnswerSubmissionResponse(
        session_id=record.session_id,
        question_id=answer.question_id,
        answer_id=answer.answer_id,
        status="accepted",
        session_status=record.status,
        evaluation=answer.evaluation,
        difficulty_adjustment=answer.difficulty_adjustment,
        next_question=next_question,
    )
