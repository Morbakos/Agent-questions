import { HttpErrorResponse } from "@angular/common/http";
import { DatePipe } from "@angular/common";
import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, inject, signal } from "@angular/core";
import { RouterLink } from "@angular/router";
import type { SessionSummary } from "@agent-questions/shared";
import { ApiService } from "../../core/api";

/** Refresh interval of the pending questions list. */
export const REFRESH_MS = 5000;

/** Home page: pending sessions (polled every `REFRESH_MS`) and the paginated history of closed ones. */
@Component({
	selector: "app-home",
	imports: [RouterLink, DatePipe],
	changeDetection: ChangeDetectionStrategy.OnPush,
	styleUrl: "./home.scss",
	template: `
		<main class="page narrow">
			<h1>Questions en attente</h1>
			@if (error()) {
				<p
					class="error"
					role="alert">
					Impossible de charger les questions ({{ error() }}). Nouvelle tentative automatique.
				</p>
			} @else if (!loaded()) {
				<p
					class="muted"
					role="status">
					Chargement…
				</p>
			} @else if (sessions().length === 0) {
				<p class="muted">
					Aucune question en attente. Quand un agent appellera <code>ask_user</code>, elle apparaîtra ici.
				</p>
			}
			<ul class="session-list">
				@for (s of sessions(); track s.id) {
					<li>
						<a [routerLink]="['/s', s.id]">
							<span class="s-title">{{ s.title }}</span>
							<span class="muted small"
								>{{ s.questionCount }} {{ s.questionCount > 1 ? "questions" : "question" }}, reçues le
								{{ s.createdAt | date: "dd/MM à HH:mm" }}</span
							>
						</a>
					</li>
				}
			</ul>

			@if (history().length > 0) {
				<h2 class="history-title">Historique</h2>
				<ul class="session-list history-list">
					@for (s of history(); track s.id) {
						<li>
							<a [routerLink]="['/s', s.id]">
								<span class="s-title">{{ s.title }}</span>
								<span class="muted small"
									>{{ s.questionCount }} {{ s.questionCount > 1 ? "questions" : "question" }},
									{{ s.status === "declined" ? "refusée" : "répondue" }} le
									{{ s.answeredAt | date: "dd/MM à HH:mm" }}</span
								>
							</a>
						</li>
					}
				</ul>
				@if (nextBefore() !== null) {
					<button
						type="button"
						class="btn"
						(click)="loadMore()">
						Charger plus
					</button>
				}
			}
		</main>
	`,
})
export class HomeComponent implements OnInit {
	private api = inject(ApiService);
	private destroyRef = inject(DestroyRef);
	readonly sessions = signal<SessionSummary[]>([]);
	readonly history = signal<SessionSummary[]>([]);
	/** Cursor of the next history page; `null` when there are no more. */
	readonly nextBefore = signal<string | null>(null);
	/** True as soon as the list has been loaded once: before that, "no question" would be wrong. */
	readonly loaded = signal(false);
	readonly error = signal<string | null>(null);
	private loading = false;

	/** Ids of the pending questions at the last tick: a change signals a closure to reload. */
	private pendingKey: string | null = null;

	ngOnInit() {
		const load = () => {
			// No new request while the previous one has not come back, nor for a hidden tab.
			if (this.loading || (this.loaded() && document.visibilityState === "hidden")) {
				return Promise.resolve();
			}
			this.loading = true;
			return this.api
				.list()
				.then(
					(l) => {
						this.sessions.set(l);
						this.loaded.set(true);
						this.error.set(null);
						const key = l.map((s) => s.id).join(",");
						if (key === this.pendingKey) {
							return;
						}
						const first = this.pendingKey === null;
						// Remembered after loading: on failure, the next tick retries (silently: the list
						// of pending questions, for its part, is already up to date).
						return this.refreshHistory(first)
							.then(() => {
								this.pendingKey = key;
							})
							.catch(() => undefined);
					},
					(error: unknown) => {
						// Retry on the next tick; meanwhile, say so rather than display an empty list.
						this.error.set(
							error instanceof HttpErrorResponse && error.status
								? `HTTP ${error.status}`
								: "serveur injoignable",
						);
					},
				)
				.finally(() => (this.loading = false));
		};
		void load();
		const timer = setInterval(load, REFRESH_MS);
		this.destroyRef.onDestroy(() => clearInterval(timer));
	}

	/** Reloads the first page. Pages already loaded are kept: only the new entries are added at the top. */
	private async refreshHistory(first: boolean): Promise<void> {
		const page = await this.api.history();
		const known = new Set(this.history().map((s) => s.id));
		this.history.update((cur) => [...page.items.filter((s) => !known.has(s.id)), ...cur]);
		if (first) {
			this.nextBefore.set(page.nextBefore);
		}
	}

	async loadMore(): Promise<void> {
		const before = this.nextBefore();
		if (before === null) {
			return;
		}
		try {
			const page = await this.api.history(before);
			const known = new Set(this.history().map((s) => s.id));
			this.history.update((cur) => [...cur, ...page.items.filter((s) => !known.has(s.id))]);
			this.nextBefore.set(page.nextBefore);
		} catch {
			/* the button stays displayed: the user can retry */
		}
	}
}
