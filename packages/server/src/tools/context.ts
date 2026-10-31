import type { AppConfig } from "../config.js";
import type { SessionStore } from "../session-store.js";
import type { UiHub } from "../ui-hub.js";

/** Ce dont un outil MCP a besoin : injecté par `createMcpServer`, jamais importé en global. */
export interface ToolContext {
	store: SessionStore;
	cfg: AppConfig;
	/** Onglets de l'UI ouverts : on s'en sert pour n'ouvrir qu'un onglet et pour les envoyer sur une session. */
	hub: UiHub;
	/** Consigne donnée à l'agent quand le navigateur ne s'ouvre pas seul (vide sinon). */
	relayHint: string;
}
