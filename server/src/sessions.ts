import { createHash, randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { migrate } from "./db/migrations.js";
import { type Answers, type Question, validateAnswers } from "./schema.js";

export type Status = "pending" | "answered" | "declined";

export interface Session {
	id: string;
	title: string;
	status: Status;
	/** Incrémentée à chaque modification des questions par l'agent. */
	revision: number;
	questions: Question[];
	draft: Answers;
	answers: Answers | null;
	declineReason: string | null;
	createdAt: number;
	answeredAt: number | null;
	deliveredAt: number | null;
	lastSeenAt: number | null;
}

interface Row {
	id: string;
	hash: string;
	title: string;
	questions: string;
	draft: string;
	answers: string | null;
	status: Status;
	revision: number;
	decline_reason: string | null;
	created_at: number;
	answered_at: number | null;
	delivered_at: number | null;
	last_seen_at: number | null;
}

export class HttpError extends Error {
	constructor(
		public status: number,
		message: string,
		public details?: string[],
	) {
		super(message);
	}
}

export function hashQuestions(title: string, questions: Question[]): string {
	return createHash("sha256").update(JSON.stringify({ title, questions })).digest("hex");
}

export class SessionStore {
	private db: DatabaseSync;
	private events = new EventEmitter();

	constructor(file: string) {
		mkdirSync(dirname(file), { recursive: true });
		this.db = new DatabaseSync(file);
		this.events.setMaxListeners(0);
		this.db.exec("PRAGMA journal_mode = WAL");
		migrate(this.db);
	}

	// node:sqlite type les lignes en Record<string, SQLOutputValue> : on les type ici, une seule fois.
	private one<T>(sql: string, ...params: string[]): T | undefined {
		return this.db.prepare(sql).get(...params) as T | undefined;
	}

	private all<T>(sql: string, ...params: string[]): T[] {
		return this.db.prepare(sql).all(...params) as T[];
	}

	private row(id: string): Row | undefined {
		return this.one<Row>("SELECT * FROM sessions WHERE id = ?", id);
	}

	private toSession(r: Row): Session {
		return {
			id: r.id,
			title: r.title,
			status: r.status,
			revision: r.revision,
			questions: JSON.parse(r.questions) as Question[],
			draft: JSON.parse(r.draft) as Answers,
			answers: r.answers ? (JSON.parse(r.answers) as Answers) : null,
			declineReason: r.decline_reason,
			createdAt: r.created_at,
			answeredAt: r.answered_at,
			deliveredAt: r.delivered_at,
			lastSeenAt: r.last_seen_at,
		};
	}

	get(id: string): Session | undefined {
		const r = this.row(id);
		return r ? this.toSession(r) : undefined;
	}

	private mustGet(id: string): Session {
		const s = this.get(id);
		if (!s) throw new HttpError(404, "Session introuvable");
		return s;
	}

	/**
	 * Reprise idempotente : un même jeu de questions retrouve la session en cours,
	 * ou une session répondue mais dont l'agent n'a pas encore reçu les réponses.
	 */
	findOrCreate(input: { sessionId?: string; title: string; questions: Question[] }): {
		session: Session;
		created: boolean;
	} {
		if (input.sessionId) {
			const r = this.row(input.sessionId);
			if (!r) throw new Error(`session_id inconnu : ${input.sessionId}`);
			return { session: this.toSession(r), created: false };
		}
		const hash = hashQuestions(input.title, input.questions);
		const existing = this.one<Row>(
			`SELECT * FROM sessions
       WHERE hash = ? AND (status = 'pending' OR delivered_at IS NULL)
       ORDER BY created_at DESC LIMIT 1`,
			hash,
		);
		if (existing) return { session: this.toSession(existing), created: false };

		const id = randomUUID();
		this.db
			.prepare(
				`INSERT INTO sessions (id, hash, title, questions, status, created_at)
         VALUES (?, ?, ?, ?, 'pending', ?)`,
			)
			.run(id, hash, input.title, JSON.stringify(input.questions), Date.now());
		return { session: this.mustGet(id), created: true };
	}

	/**
	 * Remplace les questions d'une session en attente (édition par l'agent). Le brouillon de l'utilisateur est
	 * conservé pour les questions qui subsistent, sans les options qui n'existent plus.
	 */
	updateQuestions(id: string, title: string | undefined, questions: Question[]): Session {
		const s = this.mustGet(id);
		if (s.status !== "pending") throw new HttpError(409, "Cette session est déjà clôturée.");
		const newTitle = title ?? s.title;
		const draft: Answers = {};
		for (const q of questions) {
			const d = s.draft[q.id];
			if (!d) continue;
			const known = new Set((q.options ?? []).map((o) => o.id));
			draft[q.id] = { ...d, selected: d.selected.filter((x) => known.has(x)) };
		}
		this.db
			.prepare(
				`UPDATE sessions SET title = ?, questions = ?, draft = ?, hash = ?, revision = revision + 1 WHERE id = ?`,
			)
			.run(newTitle, JSON.stringify(questions), JSON.stringify(draft), hashQuestions(newTitle, questions), id);
		return this.mustGet(id);
	}

	listOpen(): Session[] {
		const rows = this.all<Row>("SELECT * FROM sessions WHERE status = 'pending' ORDER BY created_at DESC");
		return rows.map((r) => this.toSession(r));
	}

	touch(id: string): void {
		this.db.prepare("UPDATE sessions SET last_seen_at = ? WHERE id = ?").run(Date.now(), id);
	}

	saveDraft(id: string, draft: Answers): void {
		const s = this.mustGet(id);
		if (s.status !== "pending") throw new HttpError(409, "Cette session est déjà clôturée.");
		this.db.prepare("UPDATE sessions SET draft = ? WHERE id = ?").run(JSON.stringify(draft), id);
	}

	submit(id: string, answers: Answers): Session {
		const s = this.mustGet(id);
		if (s.status !== "pending") throw new HttpError(409, "Cette session est déjà clôturée.");
		const errors = validateAnswers(s.questions, answers);
		if (errors.length) throw new HttpError(422, "Réponses invalides", errors);
		this.db
			.prepare("UPDATE sessions SET status = 'answered', answers = ?, answered_at = ? WHERE id = ?")
			.run(JSON.stringify(answers), Date.now(), id);
		this.events.emit(id);
		return this.mustGet(id);
	}

	decline(id: string, reason: string): Session {
		const s = this.mustGet(id);
		if (s.status !== "pending") throw new HttpError(409, "Cette session est déjà clôturée.");
		this.db
			.prepare("UPDATE sessions SET status = 'declined', decline_reason = ?, answered_at = ? WHERE id = ?")
			.run(reason, Date.now(), id);
		this.events.emit(id);
		return this.mustGet(id);
	}

	/** Ferme la base (arrêt propre ; libère aussi le fichier, ce que Windows exige avant de le supprimer). */
	close(): void {
		this.db.close();
	}

	markDelivered(id: string): void {
		this.db
			.prepare("UPDATE sessions SET delivered_at = ? WHERE id = ? AND delivered_at IS NULL")
			.run(Date.now(), id);
	}

	/** Attend la clôture de la session (réponse, refus), le délai, ou l'abandon de l'appelant. */
	wait(id: string, ms: number, signal?: AbortSignal): Promise<Session> {
		const current = this.mustGet(id);
		if (current.status !== "pending" || ms <= 0) return Promise.resolve(current);
		return new Promise((resolve) => {
			const finish = () => {
				clearTimeout(timer);
				this.events.off(id, finish);
				signal?.removeEventListener("abort", finish);
				resolve(this.mustGet(id));
			};
			const timer = setTimeout(finish, ms);
			this.events.on(id, finish);
			signal?.addEventListener("abort", finish, { once: true });
		});
	}
}
