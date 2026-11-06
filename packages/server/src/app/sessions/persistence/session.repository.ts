import type { Answers, Question } from "@agent-questions/shared";
import type { Session } from "@app/sessions/domain/session.js";
import type { SessionCursor } from "@app/sessions/domain/session-cursor.js";

/** Content of a session to create; `hash` comes from `hashQuestions`. */
export interface NewSession {
	title: string;
	hash: string;
	questions: Question[];
}

export type Outcome = { kind: "answered"; answers: Answers } | { kind: "declined"; reason: string };

/**
 * Persistence of question sessions, with no business rule (statuses, validation, waiting: see `SessionsService`).
 *
 * **Every method is filtered by owner**: another user's session is simply not found, even with its id. The repository
 * guarantees isolation, not the caller. Abstract class: it is also the Nest injection token, which allows plugging in
 * another implementation (PostgreSQL, for example).
 */
export abstract class SessionRepository {
	abstract get(owner: string, id: string): Promise<Session | undefined>;
	/** The owner's session with this hash that is pending, or whose answers the agent has not yet received. */
	abstract findReusable(owner: string, hash: string): Promise<Session | undefined>;
	abstract create(owner: string, input: NewSession): Promise<Session>;
	/**
	 * Atomic idempotent resumption: returns the reusable session for this hash, otherwise creates the session, with no
	 * concurrent call able to create a second one. `limit` caps the owner's pending sessions: beyond it,
	 * `undefined` (nothing is created).
	 */
	abstract findOrCreate(
		owner: string,
		input: NewSession,
		limit: number,
	): Promise<{ session: Session; created: boolean } | undefined>;
	/** Replaces title, questions, draft and hash, and increments the revision. */
	abstract replaceQuestions(owner: string, id: string, input: NewSession & { draft: Answers }): Promise<void>;
	abstract saveDraft(owner: string, id: string, draft: Answers): Promise<void>;
	/** Records the outcome and sets `answeredAt` to `at` (ms). Does not check the current status: the service does. */
	abstract close(owner: string, id: string, outcome: Outcome, at: number): Promise<void>;
	/** Sets `deliveredAt` once: a session already delivered keeps its first date. */
	abstract markDelivered(owner: string, id: string, at: number): Promise<void>;
	/** Pending sessions of the owner, most recent first. */
	abstract listOpen(owner: string): Promise<Session[]>;
	/**
	 * Closed sessions, most recent first (`answeredAt` then `id` descending), at most `limit`, strictly after the
	 * `before` cursor (first page if absent). `before.at` is compared with `answeredAt` (ms), unlike
	 * `listAll`, which compares `createdAt`.
	 */
	abstract listClosed(owner: string, limit: number, before?: SessionCursor): Promise<Session[]>;
	/**
	 * **The only methods without an owner filter**, reserved for admin supervision (read-only: no write method exists
	 * without an owner).
	 */
	abstract findAnyById(id: string): Promise<Session | undefined>;
	/**
	 * All sessions of all users, most recent first (`createdAt` then `id` descending), strictly after the `before`
	 * cursor (first page if absent).
	 */
	abstract listAll(limit: number, before?: SessionCursor): Promise<Session[]>;
	/** Assigns the sessions of `from` to `to` (taking over pre-accounts sessions). Returns their number. */
	abstract reassignOwner(from: string, to: string): Promise<number>;
}
