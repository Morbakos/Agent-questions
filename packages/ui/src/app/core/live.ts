import { DestroyRef, Injectable, computed, effect, inject, signal } from "@angular/core";
import { Title } from "@angular/platform-browser";
import { Router } from "@angular/router";
import type { UiNewSessionEvent } from "@agent-questions/shared";

/**
 * Flux `/api/events` : le serveur annonce les nouvelles questions de l'agent. Sur une page où il n'y a rien à perdre
 * (liste, confirmation…) on y va directement ; sur un formulaire affiché on le propose, sans forcer la main.
 */
@Injectable({ providedIn: "root" })
export class LiveService {
	private readonly router = inject(Router);
	private readonly title = inject(Title);
	private readonly destroyRef = inject(DestroyRef);

	/** Vrai tant qu'un formulaire à remplir est affiché (renseigné par la page de session). */
	readonly editing = signal(false);
	private readonly incoming = signal<UiNewSessionEvent | null>(null);
	/** Nouvelles questions proposées à l'utilisateur, seulement tant qu'un formulaire est affiché. */
	readonly offer = computed(() => (this.editing() ? this.incoming() : null));

	/** Titre de l'onglet avant qu'on y ajoute le repère « (1) » ; `null` tant qu'il n'y en a pas. */
	private baseTitle: string | null = null;

	constructor() {
		// Une proposition n'a plus de sens une fois le formulaire quitté : la liste montre la session.
		effect(() => {
			if (!this.editing()) {
				this.incoming.set(null);
			}
		});
	}

	start(): void {
		if (typeof EventSource === "undefined") {
			return;
		}
		// EventSource se reconnecte tout seul si le serveur redémarre.
		const source = new EventSource("/api/events");
		source.addEventListener("new-session", (event) =>
			this.onNewSession(JSON.parse((event as MessageEvent<string>).data) as UiNewSessionEvent),
		);
		const onVisibility = () => {
			if (!document.hidden) {
				this.clearUnseen();
			}
		};
		document.addEventListener("visibilitychange", onVisibility);
		this.destroyRef.onDestroy(() => {
			source.close();
			document.removeEventListener("visibilitychange", onVisibility);
		});
	}

	/** Va sur les questions proposées. */
	open(): void {
		const offer = this.offer();
		if (!offer) {
			return;
		}
		this.incoming.set(null);
		void this.router.navigate(["/s", offer.sessionId]);
	}

	dismiss(): void {
		this.incoming.set(null);
	}

	private onNewSession(event: UiNewSessionEvent): void {
		if (this.router.url === `/s/${event.sessionId}`) {
			return; // déjà dessus (c'est l'onglet que le serveur vient d'ouvrir)
		}
		this.markUnseen();
		if (this.editing()) {
			this.incoming.set(event);
			return;
		}
		void this.router.navigate(["/s", event.sessionId]);
	}

	/** Un site ne peut pas passer son onglet au premier plan : en arrière-plan, on le signale dans son titre. */
	private markUnseen(): void {
		if (!document.hidden || this.baseTitle !== null) {
			return;
		}
		this.baseTitle = this.title.getTitle();
		this.title.setTitle(`(1) ${this.baseTitle}`);
	}

	private clearUnseen(): void {
		if (this.baseTitle === null) {
			return;
		}
		this.title.setTitle(this.baseTitle);
		this.baseTitle = null;
	}
}
