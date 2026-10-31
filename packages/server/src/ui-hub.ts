import type { ServerResponse } from "node:http";
import type { UiNewSessionEvent } from "@agent-questions/shared";

/** Délai pendant lequel un onglet qu'on vient d'ouvrir (et qui ne s'est pas encore connecté) compte comme ouvert. */
const OPEN_GRACE_MS = 15_000;
/** Une annonce récente est rejouée à l'onglet qui se connecte juste après. */
const REPLAY_MS = 10_000;

/**
 * Onglets de l'UI connectés (flux SSE `/api/events`). Sert à n'ouvrir qu'un seul onglet du navigateur, et à annoncer
 * aux onglets ouverts les nouvelles questions (c'est l'UI qui décide d'y aller ou de le proposer).
 */
export class UiHub {
	private clients = new Set<ServerResponse>();
	private lastAnnounce: { event: UiNewSessionEvent; at: number } | null = null;
	private openedAt = 0;

	/** Vrai si une UI est connectée, ou vient d'être ouverte et n'a pas encore eu le temps de se connecter. */
	get hasUi(): boolean {
		return this.clients.size > 0 || Date.now() - this.openedAt < OPEN_GRACE_MS;
	}

	/** À appeler quand le serveur ouvre lui-même un onglet. */
	markOpened(): void {
		this.openedAt = Date.now();
	}

	add(res: ServerResponse): void {
		this.clients.add(res);
		res.on("close", () => this.clients.delete(res));
		if (this.lastAnnounce && Date.now() - this.lastAnnounce.at < REPLAY_MS) {
			this.send(res, this.lastAnnounce.event);
		}
	}

	/** Annonce aux onglets ouverts une nouvelle session de questions. */
	announce(session: { id: string; title: string }): void {
		const event = { sessionId: session.id, title: session.title };
		this.lastAnnounce = { event, at: Date.now() };
		for (const res of this.clients) {
			this.send(res, event);
		}
	}

	private send(res: ServerResponse, event: UiNewSessionEvent): void {
		res.write(`event: new-session\ndata: ${JSON.stringify(event)}\n\n`);
	}
}
