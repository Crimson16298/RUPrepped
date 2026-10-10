from dataclasses import dataclass
from typing import Protocol

from app.database.store import AnswerRecord
from app.schemas import AnswerEvaluation, CreateSessionRequest, InterviewType, ProviderMode, Question, SkillCategory


QUESTION_BANK: dict[InterviewType, list[tuple[str, SkillCategory, str]]] = {
    InterviewType.BEHAVIORAL: [
        ("Tell me about a time you received constructive feedback and how you used it.", SkillCategory.COMMUNICATION, "behavioral-feedback"),
        ("Describe a time you helped a teammate overcome a challenge.", SkillCategory.TEAMWORK, "behavioral-teamwork"),
        ("Tell me about a difficult decision you made with incomplete information.", SkillCategory.PROBLEM_SOLVING, "behavioral-decision"),
    ],
    InterviewType.TECHNICAL: [
        ("How would you design a service that safely accepts and validates user input?", SkillCategory.TECHNICAL_FUNDAMENTALS, "technical-validation"),
        ("Walk me through how you would debug a slow API endpoint.", SkillCategory.PROBLEM_SOLVING, "technical-debugging"),
        ("Explain a trade-off you would consider when choosing a database index.", SkillCategory.TECHNICAL_FUNDAMENTALS, "technical-indexing"),
    ],
    InterviewType.MIXED: [
        ("Tell me about a project where you had to learn a technical concept quickly.", SkillCategory.COMMUNICATION, "mixed-learning"),
        ("How would you break down an unfamiliar technical problem for your team?", SkillCategory.PROBLEM_SOLVING, "mixed-breakdown"),
        ("Describe a time you balanced implementation quality with a deadline.", SkillCategory.TEAMWORK, "mixed-deadline"),
    ],
}


@dataclass(frozen=True)
class GeneratedQuestion:
    question_text: str
    skill_category: SkillCategory
    question_id_hint: str | None = None


class InterviewProvider(Protocol):
    mode: ProviderMode

    def generate_question(self, request: CreateSessionRequest, questions: list[Question], answers: list[AnswerRecord], difficulty: int) -> GeneratedQuestion: ...

    def evaluate_answer(self, request: CreateSessionRequest, question: Question, transcript: str, questions: list[Question], answers: list[AnswerRecord]) -> AnswerEvaluation: ...


def _unique_question_id(base_id: str, questions: list[Question]) -> str:
    existing = {question.question_id for question in questions}
    if base_id not in existing:
        return base_id
    suffix = 2
    while f"{base_id}_{suffix}" in existing:
        suffix += 1
    return f"{base_id}_{suffix}"


def build_mock_question(request: CreateSessionRequest, questions: list[Question], difficulty: int) -> Question:
    """Return one deterministic mock question; unique IDs support interviews longer than the source bank."""
    source = QUESTION_BANK[request.interview_type]
    text, category, slug = source[len(questions) % len(source)]
    return Question(question_id=_unique_question_id(f"q_{slug}_{difficulty}", questions), question_text=text, skill_category=category, difficulty=difficulty, interview_type=request.interview_type)
