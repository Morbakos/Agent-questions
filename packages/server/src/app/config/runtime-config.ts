import type { AppConfig } from "./config.js";

let current: AppConfig | undefined;

/**
 * Configuration read by modules whose **decorators** depend on it (MCP tool descriptions): a decorator is
 * evaluated when the file is imported, before any injection. `QuestionsMcpModule.register` therefore calls it just
 * before `await import("./api/question-tools.js")`, which guarantees it is set when the class is defined. Use it only
 * for that: everywhere else, the configuration is injected (`@Inject(appConfig.KEY)`).
 */
export function setRuntimeConfig(config: AppConfig): void {
	current = config;
}

/** @throws Error if `setRuntimeConfig` has not been called yet (the module importing this was loaded too early). */
export function getRuntimeConfig(): AppConfig {
	if (!current) {
		throw new Error("Configuration non initialisée : appeler setRuntimeConfig() avant d'importer ce module.");
	}
	return current;
}
