from app.schemas import CreateSessionRequest, InterviewType, Question, SkillCategory


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


def build_questions(request: CreateSessionRequest) -> list[Question]:
    """Return deterministic mock questions; no model or external service is used."""
    source = QUESTION_BANK[request.interview_type]
    return [
        Question(
            question_id=f"q_{slug}_{request.difficulty}",
            question_text=text,
            skill_category=category,
            difficulty=request.difficulty,
            interview_type=request.interview_type,
        )
        for text, category, slug in (source[index % len(source)] for index in range(request.question_count))
    ]
