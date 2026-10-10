from app.schemas import AnswerEvaluation


def evaluate_transcript(transcript: str) -> AnswerEvaluation:
    """Return transparent, deterministic placeholder feedback; this is not Gemini evaluation."""
    word_count = len(transcript.split())
    if word_count >= 40:
        score = 85
        strengths = ["Provided a detailed response with enough context to assess."]
        improvements = ["Add a specific outcome or measurable impact where possible."]
        feedback = "Mock evaluation: the response has useful detail. Make the result more concrete."
    elif word_count >= 15:
        score = 70
        strengths = ["Provided a relevant response with a clear starting point."]
        improvements = ["Add more context, actions, and an outcome to strengthen the answer."]
        feedback = "Mock evaluation: expand the example into a complete explanation."
    else:
        score = 45
        strengths = ["Submitted a response for the question."]
        improvements = ["Provide a fuller explanation with context, actions, and an outcome."]
        feedback = "Mock evaluation: the response is brief; add concrete detail."
    return AnswerEvaluation(
        evaluation_source="mock_deterministic",
        is_mock=True,
        score=score,
        strengths=strengths,
        improvements=improvements,
        feedback=feedback,
    )
