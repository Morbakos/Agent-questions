import type { LogLevel } from "@nestjs/common";

/** Nest log levels for each `AQ_LOG` value (the most verbose also enables the more severe ones). */
const BY_LEVEL: Record<string, LogLevel[]> = {
	fatal: ["fatal"],
	error: ["fatal", "error"],
	warn: ["fatal", "error", "warn"],
	info: ["fatal", "error", "warn", "log"],
	debug: ["fatal", "error", "warn", "log", "debug"],
	trace: ["fatal", "error", "warn", "log", "debug", "verbose"],
};

/**
 * Nest `Logger` levels for `AQ_LOG`, or `false` for `silent`. This is the application's **only** log: Fastify has
 * none of its own (`logger: false`, see `createFastifyAdapter`), otherwise there would be two formats and two
 * settings.
 */
export const nestLogLevels = (level: string): LogLevel[] | false => BY_LEVEL[level] ?? false;
