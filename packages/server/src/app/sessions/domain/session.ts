import { createHash } from "node:crypto";
import type { Answers, Question, Status } from "@agent-questions/shared";

/** A set of questions asked by an agent and its outcome. Timestamps are milliseconds since the epoch. */
export interface Session {
	id: string;
	/** User the questions belong to: only they can answer. */
	ownerId: string;
	title: string;
	status: Status;
	/** Incremented each time the agent modifies the questions. */
	revision: number;
	questions: Question[];
	draft: Answers;
	answers: Answers | null;
	declineReason: string | null;
	createdAt: number;
	/** Closing date, for an answer as well as a refusal. */
	answeredAt: number | null;
	/** When the agent first received the outcome; while `null`, the session can still be resumed by `findOrCreate`. */
	deliveredAt: number | null;
}

/**
 * Identity of a question set (SHA-256 of title + questions, key order included): the key of idempotent resumption.
 * Changing the title or any question changes the hash.
 */
export function hashQuestions(title: string, questions: Question[]): string {
	return createHash("sha256").update(JSON.stringify({ title, questions })).digest("hex");
}
