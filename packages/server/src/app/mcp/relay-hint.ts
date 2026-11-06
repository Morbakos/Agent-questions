import type { AppConfig } from "@app/config/config.js";

/** Instruction given to the agent when the browser does not open by itself (empty otherwise). */
export function relayHintOf({ noOpen, baseUrl }: AppConfig): string {
	return noOpen
		? "The answer form does not open by itself. " +
				`Before calling this tool, tell the user to open ${baseUrl} in a browser: pending question sets are ` +
				"listed there and appear within a few seconds. Then call ask_user once."
		: "";
}
