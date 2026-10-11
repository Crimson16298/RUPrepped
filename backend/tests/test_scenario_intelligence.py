import json

import pytest

from app.database.store import AnswerRecord, InMemorySessionStore, SessionRecord
from app.schemas import AnswerEvaluation, AnswerSubmissionRequest, CreateSessionRequest, DifficultyAdjustment, ProviderMode, Question, RubricScores, SessionStatus, SkillCategory
from app.services.interview import GeneratedQuestion
from app.services.prompts import _history, build_evaluation_prompt, build_question_prompt
from app.services.providers import ProviderUnavailableError
from app.services.session import LifecycleError, start, submit_answer


def _request(*, question_count: int = 3) -> CreateSessionRequest:
    return CreateSessionRequest(
        interview_type="behavioral",
        question_count=question_count,
        target_role_or_subject="Practice talking to classmates",
        job_description="I struggle with starting casual conversations.",
    )


def _evaluation() -> AnswerEvaluation:
    return AnswerEvaluation(
        evaluation_source="gemini",
        is_mock=False,
        score=72,
        rubric=RubricScores(
            relevance=75,
            completeness=65,
            clarity=78,
            reasoning=68,
            concrete_details=60,
            technical_correctness=None,
        ),
        strengths=["Responded to the scenario."],
        improvements=["Build on the other person's response."],
        feedback="Keep the exchange focused on the scenario.",
    )


class CapturingProvider:
    mode = ProviderMode.GEMINI

    def __init__(self) -> None:
        self.answer_histories: list[list[str]] = []
        self.fail_next_generation = False
        self.generation_count = 0

    def generate_question(
        self,
        request: CreateSessionRequest,
        questions: list[Question],
        answers: list[AnswerRecord],
        difficulty: int,
    ) -> GeneratedQuestion:
        self.answer_histories.append([answer.transcript for answer in answers])
        if self.fail_next_generation:
            raise ProviderUnavailableError("The next turn could not be generated.")
        self.generation_count += 1
        return GeneratedQuestion(
            question_text=f"Simulation turn {self.generation_count} at level {difficulty}.",
            skill_category=SkillCategory.COMMUNICATION,
        )

    def evaluate_answer(
        self,
        request: CreateSessionRequest,
        question: Question,
        transcript: str,
        questions: list[Question],
        answers: list[AnswerRecord],
    ) -> AnswerEvaluation:
        return _evaluation()


def _record(*, question_count: int = 3) -> tuple[SessionRecord, CapturingProvider]:
    store = InMemorySessionStore()
    record = store.create(_request(question_count=question_count), ProviderMode.GEMINI)
    provider = CapturingProvider()
    start(record, provider)
    return record, provider


def test_next_turn_receives_each_answer_once_in_complete_history() -> None:
    record, provider = _record(question_count=3)
    first_question = record.questions[0]

    _, second_question = submit_answer(
        record,
        AnswerSubmissionRequest(question_id=first_question.question_id, transcript="Hi, how has your week been?"),
        provider,
    )
    assert second_question is not None
    assert provider.answer_histories == [[], ["Hi, how has your week been?"]]

    _, third_question = submit_answer(
        record,
        AnswerSubmissionRequest(question_id=second_question.question_id, transcript="That sounds fun; what class are you enjoying most?"),
        provider,
    )
    assert third_question is not None
    assert provider.answer_histories[-1] == [
        "Hi, how has your week been?",
        "That sounds fun; what class are you enjoying most?",
    ]
    assert len(provider.answer_histories[-1]) == 2


def test_generation_failure_keeps_session_unchanged_and_retry_is_safe() -> None:
    record, provider = _record(question_count=2)
    first_question = record.questions[0]
    payload = AnswerSubmissionRequest(question_id=first_question.question_id, transcript="I would start with a friendly greeting.")
    provider.fail_next_generation = True

    with pytest.raises(ProviderUnavailableError):
        submit_answer(record, payload, provider)

    assert record.status is SessionStatus.IN_PROGRESS
    assert record.current_question_index == 0
    assert record.answers == []
    assert record.questions == [first_question]

    provider.fail_next_generation = False
    answer, next_question = submit_answer(record, payload, provider)
    assert answer.answer_id == "ans_01"
    assert next_question is not None
    assert len(record.answers) == 1
    assert len(record.questions) == 2
    assert provider.answer_histories[-1] == [payload.transcript]


def test_final_turn_completes_without_generating_another_turn() -> None:
    record, provider = _record(question_count=1)
    answer, next_question = submit_answer(
        record,
        AnswerSubmissionRequest(question_id=record.questions[0].question_id, transcript="A concise final response."),
        provider,
    )

    assert answer.answer_id == "ans_01"
    assert next_question is None
    assert record.status is SessionStatus.COMPLETED
    assert provider.answer_histories == [[]]


def test_question_id_validation_and_duplicate_answer_protection_are_preserved() -> None:
    record, provider = _record(question_count=2)
    first_question = record.questions[0]

    with pytest.raises(LifecycleError, match="question_not_current"):
        submit_answer(record, AnswerSubmissionRequest(question_id="q_wrong", transcript="answer"), provider)

    submit_answer(record, AnswerSubmissionRequest(question_id=first_question.question_id, transcript="first answer"), provider)

    with pytest.raises(LifecycleError, match="question_already_answered"):
        submit_answer(record, AnswerSubmissionRequest(question_id=first_question.question_id, transcript="duplicate answer"), provider)


def test_history_labels_speakers_and_preserves_chronological_turn_order() -> None:
    first = Question(
        question_id="q_1", question_text="What would you like to discuss?",
        skill_category=SkillCategory.COMMUNICATION, difficulty=2, interview_type="behavioral",
    )
    second = Question(
        question_id="q_2", question_text="I hear you about the dishes.",
        skill_category=SkillCategory.COMMUNICATION, difficulty=2, interview_type="behavioral",
    )
    first_answer = AnswerRecord(
        answer_id="ans_01", question_id="q_1",
        transcript="The dishes are often left in the sink, and it bothers me.",
        audio_reference=None, evaluation=_evaluation(),
        difficulty_adjustment=DifficultyAdjustment(
            previous_difficulty=2, next_difficulty=2, decision="maintain", rationale="Continue at this level.",
        ),
    )

    history = json.loads(_history([first, second], [first_answer]))

    assert [turn["turn"] for turn in history] == [1, 2]
    assert [turn["AI character (simulator) said"] for turn in history] == [
        "What would you like to discuss?", "I hear you about the dishes.",
    ]
    assert history[0]["User said"] == "The dishes are often left in the sink, and it bothers me."
    assert "User said" not in history[1]


def test_generation_prompt_forbids_speaker_misattribution_and_invented_events() -> None:
    question = Question(
        question_id="q_1", question_text="I usually clean up after myself. What do you mean?",
        skill_category=SkillCategory.COMMUNICATION, difficulty=2, interview_type="behavioral",
    )
    answer = AnswerRecord(
        answer_id="ans_01", question_id="q_1",
        transcript="There are stains on the counter and dishes in the sink.",
        audio_reference=None, evaluation=_evaluation(),
        difficulty_adjustment=DifficultyAdjustment(
            previous_difficulty=2, next_difficulty=2, decision="maintain", rationale="Continue at this level.",
        ),
    )
    prompt = build_question_prompt(_request(), [question], [answer], 2)

    assert '"AI character (simulator) said": "I usually clean up after myself. What do you mean?"' in prompt
    assert '"User said": "There are stains on the counter and dishes in the sink."' in prompt
    assert "Use the speaker labels in the history as authoritative" in prompt
    assert "Never attribute one participant's words, actions, apologies, profanity, claims, or intent to the other" in prompt
    assert "do not invent prior statements or actions" in prompt


@pytest.mark.parametrize(
    ("objective", "description", "required_guidance"),
    [
        ("Practice a software engineering internship interview.", "Focus on Python, data structures, and teamwork.", "appropriate interviewer"),
        ("Practice a chemistry oral exam.", "Focus on equilibrium and reaction rates.", "academic examiner"),
        ("Practice talking to classmates.", "I struggle with starting casual conversations.", "realistic conversation partner"),
        ("Practice pitching my startup to investors.", "Explain the market and invite hard questions.", "intended audience"),
    ],
)
def test_question_prompt_preserves_scenario_context_and_general_practice_guidance(
    objective: str,
    description: str,
    required_guidance: str,
) -> None:
    prompt = build_question_prompt(
        CreateSessionRequest(
            interview_type="behavioral",
            target_role_or_subject=objective,
            job_description=description,
        ),
        [],
        [],
        3,
    )

    assert objective in prompt
    assert description in prompt
    assert required_guidance in prompt
    assert "practice-simulation partner" in prompt
    assert "Higher difficulty must never mean hostility" in prompt


def test_evaluation_prompt_receives_objective_and_further_description() -> None:
    objective = "Practice telling my roommate that they need to help clean our apartment."
    description = "Keep the conversation respectful and practical."
    question = Question(
        question_id="q_1",
        question_text="I have been busy lately. What do you want to discuss?",
        skill_category=SkillCategory.COMMUNICATION,
        difficulty=2,
        interview_type="behavioral",
    )
    prompt = build_evaluation_prompt(
        CreateSessionRequest(
            interview_type="behavioral",
            target_role_or_subject=objective,
            job_description=description,
        ),
        question,
        "Could we make a cleaning schedule that works for both of us?",
        [question],
        [],
    )

    assert objective in prompt
    assert description in prompt
    assert "a short, appropriate conversational response is not inherently poor" in prompt
    assert "personal disclosure, identity, or vulnerability" in prompt
    assert "technical_correctness to null" in prompt


def test_evaluation_prompt_uses_attributed_evidence_and_scores_only_latest_answer() -> None:
    objective = "Practice asking my roommate to share kitchen cleanup fairly."
    description = "Stay respectful while being specific about the problem."
    first_question = Question(
        question_id="q_1", question_text="I clean up after myself most of the time. What specifically?",
        skill_category=SkillCategory.COMMUNICATION, difficulty=2, interview_type="behavioral",
    )
    second_question = Question(
        question_id="q_2", question_text="I did leave dishes in the sink yesterday. What would help?",
        skill_category=SkillCategory.COMMUNICATION, difficulty=2, interview_type="behavioral",
    )
    earlier_user_answer = AnswerRecord(
        answer_id="ans_01", question_id="q_1",
        transcript="The counter has stains and dishes are left in the sink.",
        audio_reference=None, evaluation=_evaluation(),
        difficulty_adjustment=DifficultyAdjustment(
            previous_difficulty=2, next_difficulty=2, decision="maintain", rationale="Continue at this level.",
        ),
    )
    latest_user_answer = "Thanks for acknowledging yesterday. Can we agree to wash dishes after cooking?"
    prompt = build_evaluation_prompt(
        CreateSessionRequest(interview_type="behavioral", target_role_or_subject=objective, job_description=description),
        second_question, latest_user_answer, [first_question, second_question], [earlier_user_answer],
    )

    assert objective in prompt and description in prompt
    assert latest_user_answer in prompt
    assert "The counter has stains and dishes are left in the sink." in prompt
    assert '"AI character (simulator) said": "I did leave dishes in the sink yesterday. What would help?"' in prompt
    assert "Score only the latest User response above" in prompt
    assert "not an overall session score" in prompt
    assert "Do not invent events" in prompt
    assert "advances the stated communication goal" in prompt
    assert "personal attack or escalation may undermine" in prompt
    assert "Ground strengths and improvements in specific evidence" in prompt
    assert "Do not infer confidence or emotional states" in prompt
