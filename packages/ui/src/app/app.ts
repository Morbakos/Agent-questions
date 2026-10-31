import { ChangeDetectionStrategy, Component, inject } from "@angular/core";
import { RouterLink, RouterOutlet } from "@angular/router";
import { LiveService } from "./core/live";

@Component({
	selector: "app-root",
	imports: [RouterOutlet, RouterLink],
	changeDetection: ChangeDetectionStrategy.OnPush,
	styleUrl: "./app.scss",
	template: `
		<header class="top">
			<a
				routerLink="/"
				class="brand"
				>Questions de l'agent</a
			>
		</header>
		@if (live.offer(); as offer) {
			<div
				class="toast"
				role="status">
				<span
					>Nouvelles questions : <strong>{{ offer.title }}</strong></span
				>
				<span class="toast-actions">
					<button
						type="button"
						class="btn primary"
						(click)="live.open()">
						Y aller
					</button>
					<button
						type="button"
						class="btn quiet"
						(click)="live.dismiss()">
						Ignorer
					</button>
				</span>
			</div>
		}
		<router-outlet />
	`,
})
export class App {
	protected readonly live = inject(LiveService);

	constructor() {
		this.live.start();
	}
}
