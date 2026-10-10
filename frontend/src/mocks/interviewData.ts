import type { Question, SessionResults } from '../types/interview'

export const mockQuestions: Question[] = [
  { id: 'q1', prompt: 'Tell me about a project where you solved a problem that initially felt ambiguous.', category: 'Behavioral', estimatedMinutes: 2 },
  { id: 'q2', prompt: 'How would you explain a database index to a non-technical teammate?', category: 'Communication', estimatedMinutes: 2 },
  { id: 'q3', prompt: 'Describe a time you changed your approach after receiving feedback.', category: 'Reflection', estimatedMinutes: 2 },
  { id: 'q4', prompt: 'What trade-offs would you consider before shipping a new feature quickly?', category: 'Judgment', estimatedMinutes: 3 },
]

export const mockResults = (questions: Question[]): SessionResults => ({
  mode: 'mock',
  overallScore: 82, contentScore: 84, deliveryScore: 78,
  strengths: ['You used clear, concrete examples to support your answers.', 'Your answers showed thoughtful trade-off awareness.', 'You maintained a focused structure across the session.'],
  opportunities: ['Lead with your conclusion before adding supporting detail.', 'Add a measurable result when describing projects.', 'Practice a shorter final summary for time-limited answers.'],
  followUps: ['Explain a technical decision to a stakeholder in 60 seconds.', 'Walk through how you prioritize an ambiguous request.', 'Tell a STAR story with a stronger outcome metric.'],
  questionFeedback: questions.map((question, index) => ({ questionId: question.id, question: question.prompt, score: [84, 80, 85, 79][index] ?? 80, note: ['Strong structure and relevant example.', 'Clear analogy; add one concrete technical detail.', 'Good reflection and ownership.', 'Thoughtful trade-offs; state your recommendation earlier.'][index] ?? 'Solid response.' })),
})
