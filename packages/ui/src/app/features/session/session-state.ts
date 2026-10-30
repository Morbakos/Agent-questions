import { HttpErrorResponse } from "@angular/common/http";
import { DestroyRef, Injectable, computed, inject, signal } from "@angular/core";
import {
	type Answer,
	type Answers,
	type ApiError,
	type Question,
	type SessionView,
	emptyAnswer,
	isAnswered,
	isRequired,
} from "@agent-questions/shared";
import { ApiService } from "../../core/api";

/** `answered` et `declined` : confirmation juste après l'action ; `closed` : session passée, en lecture seule. */
export type ViewState = "loading" | "missing" | "ready" | "answered" | "declined" | "closed";

/** Intervalle de détection d'une modification des questions par l'agent. */
export const POLL_MS = 5000;
/** Délai avant l'enregistrement automatique du brouillon après une saisie. */
export const DRAFT_DELAY_MS = 600;

/**
 * État d'une session de questions : chargement, réponses en cours de saisie, brouillon, envoi, refus, et
 * rafraîchissement quand l'agent modifie les questions. Fourni par le composant de la page (une instance par page).
 */
@Injectable()
export class SessionState {
	private readonly api = inject(ApiService);
	private readonly destroyRef = inject(DestroyRef);

	private id = "";
	private saveTimer?: ReturnType<typeof setTimeout>;

	readonly state = signal<ViewState>("loading");
	readonly session = signal<SessionView | null>(null);
	readonly answers = signal<Answers>({});
	readonly savedAt = signal<Date | null>(null);
	readonly sending = signal(false);
	readonly error = signal<string | null>(null);
	/** Vrai quand l'agent a modifié les questions depuis l'ouverture de la page. */
	readonly updated = signal(false);

	readonly doneCount = computed(() => {
		const s = this.session();
		return s ? s.questions.filter((q) => this.done(q)).length : 0;
	});
	readonly missing = computed(() => {
		const s = this.session();
		return s ? s.questions.filter((q) => isRequired(q) && !this.done(q)).length : 0;
	});
	readonly canSubmit = computed(() => this.missing() === 0);

	constructor() {
		this.destroyRef.onDestroy(() => clearTimeout(this.saveTimer));
	}

	/** Charge la session puis surveille ses modifications. */
	async init(id: string): Promise<void> {
		this.id = id;
		try {
			const s = await this.api.get(id);
			this.session.set(s);
			if (s.status !== "pending") {
				return this.state.set("closed");
			}
			this.answers.set(Object.fromEntries(s.questions.map((q) => [q.id, s.draft[q.id] ?? emptyAnswer()])));
			this.state.set("ready");
		} catch {
			this.state.set("missing");
			return;
		}
		const timer = setInterval(() => void this.refresh(), POLL_MS);
		this.destroyRef.onDestroy(() => clearInterval(timer));
	}

	/** Détecte une modification des questions par l'agent (ou la clôture de la session) et met la vue à jour. */
	private async refresh(): Promise<void> {
		const current = this.session();
		if (this.state() !== "ready" || !current || this.sending()) {
			return;
		}
		try {
			const s = await this.api.get(this.id);
			if (s.status === "answered") {
				return this.state.set("answered");
			}
			if (s.status === "declined") {
				return this.state.set("declined");
			}
			if (s.revision === current.revision) {
				return;
			}
			// Les réponses en cours de saisie priment sur le brouillon, mais seulement pour les options qui existent encore.
			const local = this.answers();
			this.answers.set(
				Object.fromEntries(
					s.questions.map((q) => {
						const a = local[q.id] ?? s.draft[q.id] ?? emptyAnswer();
						const known = new Set((q.options ?? []).map((o) => o.id));
						return [q.id, { ...a, selected: a.selected.filter((id) => known.has(id)) }];
					}),
				),
			);
			this.session.set(s);
			this.updated.set(true);
		} catch {
			/* non bloquant : prochaine tentative au prochain tour */
		}
	}

	answerFor(q: Question): Answer {
		return this.answers()[q.id] ?? emptyAnswer();
	}

	done(q: Question): boolean {
		return isAnswered(q, this.answers()[q.id]);
	}

	/** Enregistre une saisie et programme l'enregistrement du brouillon. */
	onAnswer(questionId: string, answer: Answer): void {
		this.answers.update((cur) => ({ ...cur, [questionId]: answer }));
		clearTimeout(this.saveTimer);
		this.saveTimer = setTimeout(() => void this.saveDraft(), DRAFT_DELAY_MS);
	}

	private async saveDraft(): Promise<void> {
		try {
			await this.api.saveDraft(this.id, this.answers());
			this.savedAt.set(new Date());
		} catch {
			/* non bloquant : l'envoi final reste possible */
		}
	}

	async submit(): Promise<void> {
		clearTimeout(this.saveTimer);
		this.sending.set(true);
		this.error.set(null);
		try {
			await this.api.submit(this.id, this.answers());
			this.state.set("answered");
		} catch (err) {
			this.error.set(this.message(err, "L'envoi a échoué."));
		} finally {
			this.sending.set(false);
		}
	}

	async decline(reason: string): Promise<void> {
		clearTimeout(this.saveTimer);
		this.error.set(null);
		try {
			await this.api.decline(this.id, reason);
			this.state.set("declined");
		} catch (err) {
			this.error.set(this.message(err, "Le refus n'a pas pu être transmis."));
		}
	}

	private message(err: unknown, fallback: string): string {
		const body = err instanceof HttpErrorResponse ? (err.error as ApiError | null) : null;
		if (body?.details?.length) {
			return `${body.error} : ${body.details.join(" ; ")}`;
		}
		return body?.error ?? fallback;
	}
}
