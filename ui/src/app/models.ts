// Miroir des types du serveur (server/src/schema.ts). À garder synchronisé à la main.
export type QuestionType = 'single' | 'multi' | 'text';

export interface Option {
  id: string;
  label: string;
  description?: string;
  recommended?: boolean;
}

export interface Question {
  id: string;
  header?: string;
  prompt: string;
  context_markdown?: string;
  type: QuestionType;
  options?: Option[];
  allow_other?: boolean;
  required?: boolean;
  placeholder?: string;
}

export interface Answer {
  selected: string[];
  text: string;
}
export type Answers = Record<string, Answer>;

export type Status = 'pending' | 'answered' | 'declined';

export interface SessionView {
  id: string;
  title: string;
  status: Status;
  revision: number;
  questions: Question[];
  draft: Answers;
  answers: Answers | null;
  declineReason: string | null;
}

export interface SessionSummary {
  id: string;
  title: string;
  createdAt: number;
  questionCount: number;
}

export const emptyAnswer = (): Answer => ({ selected: [], text: '' });

export function isAnswered(q: Question, a?: Answer): boolean {
  if (!a) return false;
  if (q.type === 'text') return a.text.trim().length > 0;
  return a.selected.length > 0 || (!!q.allow_other && a.text.trim().length > 0);
}

export const isRequired = (q: Question): boolean => q.required !== false;
