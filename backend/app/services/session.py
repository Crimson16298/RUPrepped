from __future__ import annotations

from dataclasses import dataclass

from app.database.store import AnswerRecord, SessionRecord
from app.schemas import AnswerSubmissionRequest, Question, SessionStatus
from app.services.evaluation import evaluate_transcript


@dataclass
class LifecycleError(Exception):
    code: str
    message: str


def start(record: SessionRecord) -> SessionRecord:
    if record.status is not SessionStatus.CREATED:
        raise LifecycleError("session_already_started", "The interview has already been started.")
    record.status = SessionStatus.IN_PROGRESS
    return record


def submit_answer(record: SessionRecord, payload: AnswerSubmissionRequest) -> tuple[AnswerRecord, Question | None]:
    if record.status is SessionStatus.CREATED:
        raise LifecycleError("session_not_started", "Start the interview before submitting an answer.")
    if record.status is SessionStatus.COMPLETED:
        raise LifecycleError("session_completed", "The interview is already complete.")

    current_question = record.questions[record.current_question_index]
    if payload.question_id != current_question.question_id:
        if any(answer.question_id == payload.question_id for answer in record.answers):
            raise LifecycleError("question_already_answered", "An answer for this question has already been recorded.")
        raise LifecycleError("question_not_current", "The supplied question_id is not the current interview question.")

    evaluation = evaluate_transcript(payload.transcript)
    answer = AnswerRecord(
        answer_id=f"ans_{len(record.answers) + 1:02d}",
        question_id=payload.question_id,
        transcript=payload.transcript,
        audio_reference=payload.audio_reference,
        evaluation=evaluation,
    )
    record.answers.append(answer)
    record.current_question_index += 1
    if record.current_question_index == len(record.questions):
        record.status = SessionStatus.COMPLETED
        return answer, None
    return answer, record.questions[record.current_question_index]
