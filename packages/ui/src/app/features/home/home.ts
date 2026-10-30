import { DatePipe } from "@angular/common";
import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, inject, signal } from "@angular/core";
import { RouterLink } from "@angular/router";
import type { SessionSummary } from "@agent-questions/shared";
import { ApiService } from "../../core/api";

/** Intervalle de rafraîchissement de la liste des questions en attente. */
export const REFRESH_MS = 5000;

@Component({
	selector: "app-home",
	imports: [RouterLink, DatePipe],
	changeDetection: ChangeDetectionStrategy.OnPush,
	styleUrl: "./home.scss",
	template: `
		<main class="page narrow">
			<h1>Questions en attente</h1>
			@if (sessions().length === 0) {
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
								>{{ s.questionCount }} questions, reçues le
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
									>{{ s.questionCount }} questions,
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
	/** Curseur de la page suivante de l'historique ; `null` quand il n'y en a plus. */
	readonly nextBefore = signal<number | null>(null);

	/** Identifiants des questions en attente au dernier tour : un changement signale une clôture à recharger. */
	private pendingKey: string | null = null;

	ngOnInit() {
		const load = () =>
			this.api
				.list()
				.then((l) => {
					this.sessions.set(l);
					const key = l.map((s) => s.id).join(",");
					if (key === this.pendingKey) {
						return;
					}
					const first = this.pendingKey === null;
					// Mémorisé après le chargement : en cas d'échec, le tour suivant réessaie.
					return this.refreshHistory(first).then(() => {
						this.pendingKey = key;
					});
				})
				.catch(() => {
					/* nouvelle tentative au prochain tour */
				});
		load();
		const timer = setInterval(load, REFRESH_MS);
		this.destroyRef.onDestroy(() => clearInterval(timer));
	}

	/** Recharge la première page. Les pages déjà chargées sont conservées : seules les nouveautés sont ajoutées en tête. */
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
			/* le bouton reste affiché : l'utilisateur peut réessayer */
		}
	}
}
