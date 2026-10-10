from app.schemas import AnswerEvaluation, DifficultyAdjustment


def choose_next_difficulty(current_difficulty: int, evaluation: AnswerEvaluation) -> DifficultyAdjustment:
    """A bounded, text-only adaptation policy; future sensor context may inform a separate policy input."""
    if evaluation.score >= 80 and current_difficulty < 5:
        return DifficultyAdjustment(previous_difficulty=current_difficulty, next_difficulty=current_difficulty + 1, decision="increase", rationale="The evaluation score was 80 or higher, so the next question is one level more challenging.")
    if evaluation.score <= 49 and current_difficulty > 1:
        return DifficultyAdjustment(previous_difficulty=current_difficulty, next_difficulty=current_difficulty - 1, decision="decrease", rationale="The evaluation score was 49 or lower, so the next question is one level more accessible.")
    if evaluation.score >= 80:
        rationale = "The evaluation supported an increase, but difficulty is already at the maximum level of 5."
    elif evaluation.score <= 49:
        rationale = "The evaluation supported a decrease, but difficulty is already at the minimum level of 1."
    else:
        rationale = "The evaluation score is in the middle range, so the next question keeps the current difficulty."
    return DifficultyAdjustment(previous_difficulty=current_difficulty, next_difficulty=current_difficulty, decision="maintain", rationale=rationale)
