from __future__ import annotations

import json

from app.database.store import AnswerRecord
from app.schemas import CreateSessionRequest, Question


def _history(questions: list[Question], answers: list[AnswerRecord]) -> str:
    answer_by_question = {answer.question_id: answer for answer in answers}
    items = []
    for question in questions:
        item: dict[str, object] = {"question": question.question_text, "difficulty": question.difficulty}
        if answer := answer_by_question.get(question.question_id):
            item["answer"] = answer.transcript
            item["evaluation_score"] = answer.evaluation.score
        items.append(item)
    return json.dumps(items, ensure_ascii=False)


def build_question_prompt(request: CreateSessionRequest, questions: list[Question], answers: list[AnswerRecord], difficulty: int) -> str:
    return f"""You are a supportive, rigorous text interview coach. Generate exactly one new, non-repetitive interview question.
Interview type: {request.interview_type.value}
Target role or academic subject: {request.target_role_or_subject or 'not provided'}
Target difficulty (1-5): {difficulty}
Job description: {request.job_description or 'not provided'}
Resume text: {request.resume_text or 'not provided'}
Previous interview history: {_history(questions, answers)}

Return a question relevant to the supplied context. Do not ask about delivery, voice, physiology, or stress. Do not repeat a prior question. Choose one permitted skill category."""


def build_evaluation_prompt(request: CreateSessionRequest, question: Question, transcript: str, questions: list[Question], answers: list[AnswerRecord]) -> str:
    return f"""Evaluate the candidate's text-only answer to an interview question. This is not an assessment of delivery, confidence, speaking pace, physiology, or stress.
Interview type: {request.interview_type.value}
Target: {request.target_role_or_subject or 'not provided'}
Question: {question.question_text}
Candidate answer: {transcript}
Prior history: {_history(questions, answers)}

Use a 0-100 overall score and 0-100 rubric scores for relevance, completeness, clarity, reasoning, concrete_details, and technical_correctness where applicable. Return concise, actionable strengths, improvements, and feedback. For a non-technical question, set technical_correctness to null."""
