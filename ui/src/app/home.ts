import { DatePipe } from "@angular/common";
import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, inject, signal } from "@angular/core";
import { RouterLink } from "@angular/router";
import { ApiService } from "./api";
import type { SessionSummary } from "@agent-questions/shared";

@Component({
	selector: "app-home",
	imports: [RouterLink, DatePipe],
	changeDetection: ChangeDetectionStrategy.OnPush,
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
		</main>
	`,
})
export class HomeComponent implements OnInit {
	private api = inject(ApiService);
	private destroyRef = inject(DestroyRef);
	readonly sessions = signal<SessionSummary[]>([]);

	ngOnInit() {
		const load = () =>
			this.api
				.list()
				.then((l) => this.sessions.set(l))
				.catch(() => {
					/* nouvelle tentative au prochain tour */
				});
		load();
		const timer = setInterval(load, 5000);
		this.destroyRef.onDestroy(() => clearInterval(timer));
	}
}
