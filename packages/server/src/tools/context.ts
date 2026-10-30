import type { AppConfig } from "../config.js";
import type { SessionStore } from "../session-store.js";

/** Ce dont un outil MCP a besoin : injecté par `createMcpServer`, jamais importé en global. */
export interface ToolContext {
	store: SessionStore;
	cfg: AppConfig;
	/** Consigne donnée à l'agent quand le navigateur ne s'ouvre pas seul (vide sinon). */
	relayHint: string;
}
