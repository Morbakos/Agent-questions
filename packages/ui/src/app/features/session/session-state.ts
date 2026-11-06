import { DestroyRef, Injectable, computed, effect, inject, signal } from "@angular/core";
import {
	type Answer,
	type Answers,
	type Question,
	type SessionView,
	emptyAnswer,
	isAnswered,
	isRequired,
} from "@agent-questions/shared";
import { ApiService } from "../../core/api";
import { errorMessage } from "../../core/errors";
import { LiveService } from "../../core/live";

/** `answered` and `declined`: confirmation right after the action; `closed`: past session, read-only. */
export type ViewState = "loading" | "missing" | "ready" | "answered" | "declined" | "closed";

/** Interval at which a modification of the questions by the agent is detected. */
export const POLL_MS = 5000;
/** Delay before the draft is automatically saved after an edit. */
export const DRAFT_DELAY_MS = 600;

/**
 * State of a questions session: loading, answers being typed, draft, submission, refusal, and
 * refresh when the agent modifies the questions. Provided by the page component (one instance per page).
 */
@Injectable()
export class SessionState {
	private readonly api = inject(ApiService);
	private readonly destroyRef = inject(DestroyRef);
	private readonly live = inject(LiveService);

	private id = "";
	private saveTimer?: ReturnType<typeof setTimeout>;
	/** Input not yet saved in the draft. */
	private dirty = false;

	readonly state = signal<ViewState>("loading");
	/** The session as last loaded or applied (not the pending update). */
	readonly session = signal<SessionView | null>(null);
	/** Form state, keyed by question id: one entry per question of `session`, sent as is on submit. */
	readonly answers = signal<Answers>({});
	private polling = false;
	readonly savedAt = signal<Date | null>(null);
	/** The last draft save failed. */
	readonly draftFailed = signal(false);
	/** A refusal is being sent (prevents a double send). */
	readonly declineSending = signal(false);
	/** The final answers are being sent (also pauses polling). */
	readonly sending = signal(false);
	/** User-facing message of the last failed submit or decline; reset by the next attempt. */
	readonly error = signal<string | null>(null);
	/** True when the agent has modified the questions since the page was opened. */
	readonly updated = signal(false);
	/** New version of the questions sent by the agent, not yet displayed: the user chooses when to display it. */
	readonly pendingUpdate = signal<SessionView | null>(null);

	readonly doneCount = computed(() => {
		const s = this.session();
		return s ? s.questions.filter((q) => this.done(q)).length : 0;
	});
	readonly missing = computed(() => {
		const s = this.session();
		return s ? s.questions.filter((q) => isRequired(q) && !this.done(q)).length : 0;
	});
	/** Submission is suspended until the new version of the questions is displayed: the server validates against it. */
	readonly canSubmit = computed(() => this.missing() === 0 && !this.pendingUpdate());

	constructor() {
		// While a form is displayed, new questions are offered rather than opened automatically.
		effect(() => this.live.editing.set(this.state() === "ready"));
		this.destroyRef.onDestroy(() => {
			this.live.editing.set(false);
			clearTimeout(this.saveTimer);
			// The tab can leave the page at any time (new questions from the agent): the input is not lost.
			if (this.dirty) {
				void this.saveDraft();
			}
		});
	}

	/** Loads the session then watches for its modifications. */
	async init(id: string): Promise<void> {
		this.id = id;
		let destroyed = false;
		this.destroyRef.onDestroy(() => (destroyed = true));
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
		if (destroyed) {
			return; // the page was left during loading: no orphan polling
		}
		const timer = setInterval(() => void this.refresh(), POLL_MS);
		this.destroyRef.onDestroy(() => clearInterval(timer));
	}

	/** Detects a modification of the questions by the agent (offers it, without applying it) or the closing of the session. */
	private async refresh(): Promise<void> {
		const current = this.session();
		if (
			this.state() !== "ready" ||
			!current ||
			this.sending() ||
			this.polling ||
			document.visibilityState === "hidden"
		) {
			return;
		}
		this.polling = true;
		try {
			const s = await this.api.get(this.id);
			if (s.status === "answered") {
				return this.state.set("answered");
			}
			if (s.status === "declined") {
				return this.state.set("declined");
			}
			if (s.revision === current.revision || s.revision === this.pendingUpdate()?.revision) {
				return;
			}
			this.pendingUpdate.set(s);
		} catch {
			/* non-blocking: next attempt on the next tick */
		} finally {
			this.polling = false;
		}
	}

	/** Displays the new version of the questions offered by the agent, keeping the answers already entered. */
	applyUpdate(): void {
		const s = this.pendingUpdate();
		if (!s) {
			return;
		}
		// Answers being typed take precedence over the draft, but only for options that still exist.
		const local = this.answers();
		this.answers.set(
			Object.fromEntries(
				s.questions.map((q) => {
					const a = local[q.id] ?? s.draft[q.id] ?? emptyAnswer();
					const known = new Set((q.options ?? []).map((o) => o.id));
					const selected = a.selected.filter((id) => known.has(id));
					const notes = Object.fromEntries(
						Object.entries(a.notes ?? {}).filter(([id]) => selected.includes(id)),
					);
					return [q.id, Object.keys(notes).length ? { ...a, selected, notes } : { selected, text: a.text }];
				}),
			),
		);
		this.session.set(s);
		this.pendingUpdate.set(null);
		this.updated.set(true);
	}

	answerFor(q: Question): Answer {
		return this.answers()[q.id] ?? emptyAnswer();
	}

	done(q: Question): boolean {
		return isAnswered(q, this.answers()[q.id]);
	}

	/** Records an edit and schedules the saving of the draft. */
	onAnswer(questionId: string, answer: Answer): void {
		this.answers.update((cur) => ({ ...cur, [questionId]: answer }));
		this.dirty = true;
		clearTimeout(this.saveTimer);
		this.saveTimer = setTimeout(() => void this.saveDraft(), DRAFT_DELAY_MS);
	}

	private async saveDraft(): Promise<void> {
		this.dirty = false;
		try {
			await this.api.saveDraft(this.id, this.answers());
			this.savedAt.set(new Date());
			this.draftFailed.set(false);
		} catch {
			// Non-blocking (the final submission remains possible), but we do not let the user believe the input is saved.
			this.savedAt.set(null);
			this.draftFailed.set(true);
		}
	}

	/** Sends the answers. On failure (e.g. 422) stays on the form and sets `error`; on success `state` becomes `answered`. */
	async submit(): Promise<void> {
		clearTimeout(this.saveTimer);
		this.dirty = false;
		this.sending.set(true);
		this.error.set(null);
		try {
			await this.api.submit(this.id, this.answers());
			this.state.set("answered");
		} catch (err) {
			this.error.set(errorMessage(err, "L'envoi a échoué."));
		} finally {
			this.sending.set(false);
		}
	}

	/** Declines to answer, with an optional reason relayed to the agent; ignored while a decline is already in flight. */
	async decline(reason: string): Promise<void> {
		if (this.declineSending()) {
			return;
		}
		this.declineSending.set(true);
		clearTimeout(this.saveTimer);
		this.dirty = false;
		this.error.set(null);
		try {
			await this.api.decline(this.id, reason);
			this.state.set("declined");
		} catch (err) {
			this.error.set(errorMessage(err, "Le refus n'a pas pu être transmis."));
		} finally {
			this.declineSending.set(false);
		}
	}
}
