from __future__ import annotations

from dataclasses import dataclass

from app.database.store import AnswerRecord, SessionRecord
from app.schemas import AnswerSubmissionRequest, Question, SessionStatus
from app.services.interview import InterviewProvider
from app.services.policy import choose_next_difficulty


@dataclass
class LifecycleError(Exception):
    code: str
    message: str


def _question_from_provider(
    record: SessionRecord,
    provider: InterviewProvider,
    difficulty: int,
    answers: list[AnswerRecord] | None = None,
) -> Question:
    generated = provider.generate_question(record.request, record.questions, record.answers if answers is None else answers, difficulty)
    existing = {question.question_id for question in record.questions}
    base_id = generated.question_id_hint or f"q_{record.session_id[-8:]}_{len(record.questions) + 1}"
    question_id = base_id
    suffix = 2
    while question_id in existing:
        question_id = f"{base_id}_{suffix}"
        suffix += 1
    return Question(
        question_id=question_id,
        question_text=generated.question_text,
        skill_category=generated.skill_category,
        difficulty=difficulty,
        interview_type=record.request.interview_type,
    )


def start(record: SessionRecord, provider: InterviewProvider) -> Question:
    if record.status is not SessionStatus.CREATED:
        raise LifecycleError("session_already_started", "The interview has already been started.")
    question = _question_from_provider(record, provider, record.request.difficulty)
    record.questions.append(question)
    record.status = SessionStatus.IN_PROGRESS
    return question


def submit_answer(record: SessionRecord, payload: AnswerSubmissionRequest, provider: InterviewProvider) -> tuple[AnswerRecord, Question | None]:
    if record.status is SessionStatus.CREATED:
        raise LifecycleError("session_not_started", "Start the interview before submitting an answer.")
    if record.status is SessionStatus.COMPLETED:
        raise LifecycleError("session_completed", "The interview is already complete.")

    current_question = record.questions[record.current_question_index]
    if payload.question_id != current_question.question_id:
        if any(answer.question_id == payload.question_id for answer in record.answers):
            raise LifecycleError("question_already_answered", "An answer for this question has already been recorded.")
        raise LifecycleError("question_not_current", "The supplied question_id is not the current interview question.")

    evaluation = provider.evaluate_answer(record.request, current_question, payload.transcript, record.questions, record.answers)
    adjustment = choose_next_difficulty(current_question.difficulty, evaluation)
    answer = AnswerRecord(
        answer_id=f"ans_{len(record.answers) + 1:02d}",
        question_id=payload.question_id,
        transcript=payload.transcript,
        audio_reference=payload.audio_reference,
        evaluation=evaluation,
        difficulty_adjustment=adjustment,
    )
    is_final = len(record.answers) + 1 >= record.request.question_count
    if is_final:
        record.answers.append(answer)
        record.status = SessionStatus.COMPLETED
        return answer, None
    # Generate against prospective history. This makes the just-evaluated answer
    # available to the next turn without committing session state until generation
    # succeeds.
    next_question = _question_from_provider(record, provider, adjustment.next_difficulty, [*record.answers, answer])
    record.answers.append(answer)
    record.questions.append(next_question)
    record.current_question_index += 1
    return answer, next_question
