import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AppConfig } from "./config.js";
import type { SessionStore } from "./sessions.js";
import { registerAskUser } from "./tools/ask-user.js";
import type { ToolContext } from "./tools/context.js";
import { registerGetAnswers } from "./tools/get-answers.js";
import { registerUpdateQuestions } from "./tools/update-questions.js";

/**
 * Assemble le serveur MCP. Pour ajouter un outil : créer `tools/<nom>.ts` qui exporte `registerXxx(server, ctx)`,
 * puis l'appeler ci-dessous.
 */
export function createMcpServer(store: SessionStore, cfg: AppConfig): McpServer {
	// Sans ouverture automatique du navigateur (Docker, serveur distant), c'est à l'agent de transmettre l'adresse.
	// La page d'accueil liste les questions en attente et se rafraîchit seule : l'adresse de base suffit, l'agent peut
	// la donner AVANT l'appel, qui reste unique (ask_user attend la réponse). get_answers ne sert qu'après un timeout.
	const relayHint = cfg.noOpen
		? "The answer form does not open by itself. " +
			`Before calling this tool, tell the user to open ${cfg.baseUrl} in a browser: pending question sets are ` +
			"listed there and appear within a few seconds. Then call ask_user once: the call waits for the answers. " +
			"Only if it returns 'pending', call get_answers with the session_id."
		: "";
	const server = new McpServer(
		{ name: "agent-questions", version: "0.1.0" },
		relayHint ? { instructions: relayHint } : undefined,
	);

	const ctx: ToolContext = { store, cfg, relayHint };
	registerAskUser(server, ctx);
	registerUpdateQuestions(server, ctx);
	registerGetAnswers(server, ctx);

	return server;
}
