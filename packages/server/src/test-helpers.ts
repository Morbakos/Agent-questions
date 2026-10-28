import type { AppConfig } from "./config.js";
import type { Question } from "@agent-questions/shared";

/** Configuration de test : jamais d'ouverture du navigateur, base en mémoire. */
export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
	return {
		host: "127.0.0.1",
		port: 4317,
		baseUrl: "http://127.0.0.1:4317",
		allowedHosts: [],
		dbFile: ":memory:",
		uiDir: "/inexistant",
		defaultWaitSeconds: 1,
		noOpen: true,
		dev: false,
		...overrides,
	};
}

export const singleQuestion = (overrides: Partial<Question> = {}): Question => ({
	id: "choix",
	prompt: "Lequel ?",
	type: "single",
	options: [
		{ id: "a", label: "A", recommended: true },
		{ id: "b", label: "B" },
	],
	...overrides,
});

export const textQuestion = (overrides: Partial<Question> = {}): Question => ({
	id: "libre",
	prompt: "Pourquoi ?",
	type: "text",
	...overrides,
});
