import { EventEmitter } from "node:events";
import { type BeforeApplicationShutdown, Inject, Injectable } from "@nestjs/common";
import { type Answers, type Question, allowsNotes, validateAnswers } from "@agent-questions/shared";
import { HttpError } from "@app/http/http-error.js";
import { type Session, hashQuestions } from "@app/sessions/domain/session.js";
import { type SessionCursor, formatCursor } from "@app/sessions/domain/session-cursor.js";
import { SessionRepository } from "@app/sessions/persistence/session.repository.js";

/** Simultaneous pending sessions per user: bounds the work a client can impose on the server. */
export const MAX_PENDING_PER_OWNER = 100;

/**
 * Business rules of question sessions (statuses, validation, idempotent resumption, waiting for answers) on top of a
 * `SessionRepository`. Every method takes the **owner** as first argument: another user's session is not found (404),
 * never "forbidden", so as not to reveal its existence.
 */
@Injectable()
export class SessionsService implements BeforeApplicationShutdown {
	// Wakes the calls waiting for an answer. In-memory state of this process only: see CLAUDE.md before
	// splitting the UI API from the MCP handler.
	private readonly events = new EventEmitter();

	constructor(@Inject(SessionRepository) private readonly repository: SessionRepository) {
		this.events.setMaxListeners(0);
	}

	private readonly waiters = new Set<() => void>();
	private closing = false;

	/**
	 * On shutdown, wakes the waiting calls (they answer "pending") while the database is still open:
	 * otherwise closing would wait for their timeouts (up to an hour) and read a closed database. Calls that
	 * arrive afterwards, or that were not yet registered, no longer go to sleep (`closing`).
	 */
	beforeApplicationShutdown(): void {
		this.closing = true;
		for (const finish of [...this.waiters]) {
			finish();
		}
	}

	/** Returns `undefined` (not an error) when the session does not exist or belongs to someone else. */
	get(owner: string, id: string): Promise<Session | undefined> {
		return this.repository.get(owner, id);
	}

	private async mustGet(owner: string, id: string): Promise<Session> {
		const session = await this.repository.get(owner, id);
		if (!session) {
			throw new HttpError(404, "Session introuvable");
		}
		return session;
	}

	private async mustBePending(owner: string, id: string): Promise<Session> {
		const session = await this.mustGet(owner, id);
		if (session.status !== "pending") {
			throw new HttpError(409, "Cette session est déjà clôturée.");
		}
		return session;
	}

	/**
	 * Idempotent resumption: the same set of questions finds the same user's current session, or an answered session
	 * whose answers the agent has not yet received. The lookup and the creation form a single atomic repository
	 * operation: two identical simultaneous calls create only one session.
	 *
	 * With `sessionId`, the title and questions are ignored and that session is returned as is (any status).
	 * @throws HttpError 404 for an unknown `sessionId`; 409 when the owner already has `MAX_PENDING_PER_OWNER` pending sessions.
	 */
	async findOrCreate(
		owner: string,
		input: { sessionId?: string; title: string; questions: Question[] },
	): Promise<{ session: Session; created: boolean }> {
		if (input.sessionId) {
			const existing = await this.repository.get(owner, input.sessionId);
			if (!existing) {
				throw new HttpError(404, `session_id inconnu : ${input.sessionId}`);
			}
			return { session: existing, created: false };
		}
		const hash = hashQuestions(input.title, input.questions);
		const result = await this.repository.findOrCreate(
			owner,
			{ title: input.title, hash, questions: input.questions },
			MAX_PENDING_PER_OWNER,
		);
		if (!result) {
			throw new HttpError(
				409,
				`Trop de sessions en attente (${MAX_PENDING_PER_OWNER}) : répondez-y ou refusez-les.`,
			);
		}
		return result;
	}

	/**
	 * Replaces the questions of a pending session (agent edit). The user's draft is kept for the questions that
	 * remain, without the options that no longer exist.
	 *
	 * Recomputes the hash and bumps `revision` (the UI polls it to notice the change). `title` defaults to the current one.
	 * @throws HttpError 404 if unknown, 409 if the session is already closed.
	 */
	async updateQuestions(
		owner: string,
		id: string,
		title: string | undefined,
		questions: Question[],
	): Promise<Session> {
		const current = await this.mustBePending(owner, id);
		const newTitle = title ?? current.title;
		const draft: Answers = {};
		for (const question of questions) {
			const previous = current.draft[question.id];
			if (!previous) {
				continue;
			}
			const known = new Set((question.options ?? []).map((option) => option.id));
			const selected = previous.selected.filter((option) => known.has(option));
			// A note belongs to a selected option: drop those of removed options (and all of them if notes are now off),
			// otherwise the stale draft would be rejected at submit ("Note sans option choisie").
			const { notes, ...rest } = previous;
			const kept = allowsNotes(question)
				? Object.entries(notes ?? {}).filter(([option]) => selected.includes(option))
				: [];
			draft[question.id] = { ...rest, selected, ...(kept.length > 0 && { notes: Object.fromEntries(kept) }) };
		}
		await this.repository.replaceQuestions(owner, id, {
			title: newTitle,
			hash: hashQuestions(newTitle, questions),
			questions,
			draft,
		});
		return this.mustGet(owner, id);
	}

	/**
	 * Reads a session of any user, for an administrator's supervision.
	 *
	 * No owner filter: only for the read-only admin routes.
	 */
	getAny(id: string): Promise<Session | undefined> {
		return this.repository.findAnyById(id);
	}

	/** All sessions, most recent first; `before` identifies (creation, id) the last previous entry. */
	async listAll(limit: number, before?: SessionCursor): Promise<{ items: Session[]; nextBefore: string | null }> {
		const rows = await this.repository.listAll(limit + 1, before);
		const items = rows.slice(0, limit);
		const last = items.at(-1);
		return {
			items,
			nextBefore: rows.length > limit && last ? formatCursor({ at: last.createdAt, id: last.id }) : null,
		};
	}

	/** Pending sessions of the owner, most recent first. */
	listOpen(owner: string): Promise<Session[]> {
		return this.repository.listOpen(owner);
	}

	/**
	 * Closed sessions (answered or declined), most recent first. `before` is a cursor: (closing date, id) of the last
	 * entry of the previous page. `nextBefore` is `null` on the last page.
	 */
	async listClosed(
		owner: string,
		limit: number,
		before?: SessionCursor,
	): Promise<{ items: Session[]; nextBefore: string | null }> {
		const rows = await this.repository.listClosed(owner, limit + 1, before);
		const items = rows.slice(0, limit);
		const last = items.at(-1);
		const at = last?.answeredAt;
		return {
			items,
			nextBefore: rows.length > limit && last && at != null ? formatCursor({ at, id: last.id }) : null,
		};
	}

	/**
	 * Stores the unsent form state. Not validated against the questions (partial or stale drafts are fine).
	 * @throws HttpError 404 if unknown, 409 if closed.
	 */
	async saveDraft(owner: string, id: string, draft: Answers): Promise<void> {
		await this.mustBePending(owner, id);
		await this.repository.saveDraft(owner, id, draft);
	}

	/**
	 * Closes the session as answered and wakes the `wait` calls blocked on it.
	 * @throws HttpError 404 if unknown, 409 if already closed, 422 (with the error list as details) if the answers do
	 * not validate against the session's current questions.
	 */
	async submit(owner: string, id: string, answers: Answers): Promise<Session> {
		const session = await this.mustBePending(owner, id);
		const errors = validateAnswers(session.questions, answers);
		if (errors.length) {
			throw new HttpError(422, "Réponses invalides", errors);
		}
		await this.repository.close(owner, id, { kind: "answered", answers }, Date.now());
		this.events.emit(id);
		return this.mustGet(owner, id);
	}

	/** Closes the session as declined (reason relayed to the agent) and wakes the `wait` calls. 404 / 409 as `submit`. */
	async decline(owner: string, id: string, reason: string): Promise<Session> {
		await this.mustBePending(owner, id);
		await this.repository.close(owner, id, { kind: "declined", reason }, Date.now());
		this.events.emit(id);
		return this.mustGet(owner, id);
	}

	/** Marks the outcome as received by the agent: the session can no longer be resumed through `findOrCreate`. */
	markDelivered(owner: string, id: string): Promise<void> {
		return this.repository.markDelivered(owner, id, Date.now());
	}

	/**
	 * Waits for the session to close (answer, refusal), the timeout, or the caller giving up.
	 *
	 * `ms` is in milliseconds. Always resolves with the session as it is at wake-up time (still `pending` after a
	 * timeout, an abort or a shutdown); returns immediately if it is already closed or `ms <= 0`.
	 * @throws HttpError 404 if the session is unknown to this owner.
	 */
	async wait(owner: string, id: string, ms: number, signal?: AbortSignal): Promise<Session> {
		const current = await this.mustGet(owner, id);
		if (current.status !== "pending" || ms <= 0 || signal?.aborted || this.closing) {
			return current;
		}
		return new Promise((resolve, reject) => {
			const finish = () => {
				clearTimeout(timer);
				this.events.off(id, finish);
				this.waiters.delete(finish);
				signal?.removeEventListener("abort", finish);
				this.mustGet(owner, id).then(resolve, reject);
			};
			const timer = setTimeout(finish, ms);
			this.waiters.add(finish);
			this.events.on(id, finish);
			signal?.addEventListener("abort", finish, { once: true });
		});
	}
}
