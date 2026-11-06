import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** `local`: single user, no accounts, loopback only. `server`: accounts, passwords and sessions; behind HTTPS. */
export type DeploymentMode = "local" | "server";

/** Admin account created on first start of the server profile, when the database has no user yet. */
export interface AdminBootstrap {
	username: string;
	/** `null`: a random password is generated and shown once in the logs. */
	password: string | null;
}

/** Validated configuration, built once from the `AQ_*` environment variables by `loadConfig`. */
export interface AppConfig {
	/**
	 * Deployment profile. `local`: one user on their machine, listens on loopback, no IdP.
	 * `server`: several users, accounts and authentication required.
	 */
	deploymentMode: DeploymentMode;
	/** Listen address. 127.0.0.1 by default; 0.0.0.0 only in a container (publish the port on 127.0.0.1 on the host). */
	host: string;
	port: number;
	/** URL of the UI as the user must open it in their browser (used for the links returned to the agent). */
	baseUrl: string;
	/** Extra host names accepted in the Host header (e.g. the Docker service name). */
	allowedHosts: string[];
	/** Extra origins allowed to call the server from a browser. Never a wildcard. */
	allowedOrigins: string[];
	/** Path of the SQLite file (`<AQ_DATA_DIR>/agent-questions.sqlite`). */
	dbFile: string;
	/** Directory of the built UI (the one holding `index.html`), served as static files. */
	uiDir: string;
	/**
	 * Default wait of a tool call before answering "pending". In seconds, 0 to 3600; 0 means the call never blocks
	 * unless the agent passes `wait_seconds`.
	 */
	defaultWaitSeconds: number;
	/** Does not open the browser automatically. */
	noOpen: boolean;
	/** Allows the origin of the Angular dev server (localhost:4200). */
	dev: boolean;
	/**
	 * Trusted reverse proxies (`AQ_TRUST_PROXY`: number of hops). `0`: the client address is that of the connection.
	 * Without this behind a proxy, all clients share the proxy's address (and its sign-in quota).
	 */
	trustProxy: number;
	/** Log level (`AQ_LOG`). */
	logLevel: string;
	/** Set only in the server profile. */
	admin: AdminBootstrap | null;
}

/** Invalid or dangerous configuration: the message names the variable to fix, never its secret value. */
export class ConfigError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ConfigError";
	}
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "[::1]", "localhost"]);

/** Whether `host` is a loopback name or address (case-insensitive, IPv6 with or without brackets). */
export function isLoopbackHost(host: string): boolean {
	return LOOPBACK_HOSTS.has(host.toLowerCase());
}

/** Published package: the UI is copied into `dist/ui`. Monorepo (dev, tests): build of the `@agent-questions/ui` package. */
function defaultUiDir(here: string): string {
	const bundled = resolve(here, "ui");
	if (existsSync(bundled)) {
		return bundled;
	}
	try {
		return dirname(createRequire(import.meta.url).resolve("@agent-questions/ui/browser/index.html"));
	} catch {
		return bundled; // UI missing: registerStaticUi shows a message
	}
}

function list(value: string | undefined): string[] {
	return (value ?? "")
		.split(",")
		.map((item) => item.trim())
		.filter(Boolean);
}

function parseUrl(name: string, value: string): URL {
	try {
		return new URL(value);
	} catch {
		throw new ConfigError(`${name} is not a valid URL.`);
	}
}

function parseMode(env: NodeJS.ProcessEnv): DeploymentMode {
	const mode = env.AQ_DEPLOYMENT_MODE ?? "local";
	if (mode !== "local" && mode !== "server") {
		throw new ConfigError(`AQ_DEPLOYMENT_MODE must be "local" or "server" (received: "${mode}").`);
	}
	return mode;
}

function parseOrigins(env: NodeJS.ProcessEnv): string[] {
	const origins = list(env.AQ_ALLOWED_ORIGINS);
	for (const origin of origins) {
		if (origin.includes("*")) {
			throw new ConfigError("AQ_ALLOWED_ORIGINS accepts no wildcard: list the exact origins.");
		}
		const url = parseUrl("AQ_ALLOWED_ORIGINS", origin);
		if (url.origin !== origin) {
			throw new ConfigError(
				`AQ_ALLOWED_ORIGINS: "${origin}" must be an origin (scheme, host, port) without a path.`,
			);
		}
	}
	return origins;
}

function parseWaitSeconds(env: NodeJS.ProcessEnv): number {
	const value = Number(env.AQ_WAIT_SECONDS ?? 0);
	if (!Number.isInteger(value) || value < 0 || value > 3600) {
		throw new ConfigError("AQ_WAIT_SECONDS must be an integer between 0 and 3600.");
	}
	return value;
}

function parseTrustProxy(env: NodeJS.ProcessEnv): number {
	const value = Number(env.AQ_TRUST_PROXY ?? 0);
	if (!Number.isInteger(value) || value < 0 || value > 10) {
		throw new ConfigError("AQ_TRUST_PROXY must be the number of trusted reverse proxies (0 to 10).");
	}
	return value;
}

const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace", "silent"];

function parseLogLevel(env: NodeJS.ProcessEnv): string {
	const level = env.AQ_LOG ?? "info";
	if (!LOG_LEVELS.includes(level)) {
		throw new ConfigError(`AQ_LOG must be one of: ${LOG_LEVELS.join(", ")}.`);
	}
	return level;
}

function parseAdmin(env: NodeJS.ProcessEnv): AdminBootstrap {
	const username = env.AQ_ADMIN_USERNAME || "admin";
	if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,39}$/.test(username)) {
		throw new ConfigError("AQ_ADMIN_USERNAME: 3 to 40 characters (letters, digits, dot, hyphen, underscore).");
	}
	// The password length is NOT checked here: the variable is only used when the first admin is created, so a
	// leftover bad value must not prevent later starts. `AuthService.bootstrapAdmin` checks it at creation time.
	return { username, password: env.AQ_ADMIN_PASSWORD || null };
}

/** Replaces a leading `~` with the home directory (a `.env` template or `--env-file` never gets shell expansion). */
function expandHome(path: string): string {
	return path === "~" || path.startsWith("~/") || path.startsWith("~\\") ? join(homedir(), path.slice(1)) : path;
}

/**
 * Reads and validates the configuration. Throws `ConfigError` rather than starting in a dangerous combination.
 *
 * Local profile: refuses a non-loopback bind (except `0.0.0.0` when `AQ_IN_CONTAINER=1`). Server profile: requires
 * `AQ_PUBLIC_URL` (HTTPS unless loopback) and `AQ_DATA_DIR`, parses the admin bootstrap and forces `noOpen`.
 * `baseUrl` is returned without trailing slashes.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
	const deploymentMode = parseMode(env);
	const inContainer = env.AQ_IN_CONTAINER === "1";
	const host = env.AQ_BIND_HOST ?? "127.0.0.1";
	const port = Number(env.AQ_PORT ?? 4317);
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		throw new ConfigError("AQ_PORT must be a valid TCP port (1-65535).");
	}
	const allowedOrigins = parseOrigins(env);
	const dataDir = env.AQ_DATA_DIR ? expandHome(env.AQ_DATA_DIR) : join(homedir(), ".agent-questions");

	let admin: AdminBootstrap | null = null;
	let publicUrl = env.AQ_PUBLIC_URL ?? `http://127.0.0.1:${port}`;
	if (deploymentMode === "local") {
		// Loopback only. In a container, listening internally on 0.0.0.0 is allowed: the port published by
		// the host (127.0.0.1:4317:4317) is what limits exposure.
		if (!isLoopbackHost(host) && !(inContainer && host === "0.0.0.0")) {
			throw new ConfigError(
				`AQ_BIND_HOST="${host}" is refused in the local profile: use 127.0.0.1, ::1 or localhost ` +
					"(or AQ_DEPLOYMENT_MODE=server, with accounts and passwords, for network exposure).",
			);
		}
	} else {
		admin = parseAdmin(env);
		if (!env.AQ_PUBLIC_URL) {
			throw new ConfigError(
				"The server profile requires AQ_PUBLIC_URL (public URL, HTTPS behind the reverse proxy).",
			);
		}
		const url = parseUrl("AQ_PUBLIC_URL", publicUrl);
		if (url.protocol !== "https:" && !isLoopbackHost(url.hostname)) {
			throw new ConfigError("AQ_PUBLIC_URL must be HTTPS in the server profile.");
		}
		if (!env.AQ_DATA_DIR) {
			throw new ConfigError(
				"The server profile requires AQ_DATA_DIR (persistent volume dedicated to the SQLite database).",
			);
		}
	}
	publicUrl = publicUrl.replace(/\/+$/, "");
	if (deploymentMode === "local") {
		parseUrl("AQ_PUBLIC_URL", publicUrl);
	}

	const here = fileURLToPath(new URL(".", import.meta.url));
	return {
		deploymentMode,
		host,
		port,
		baseUrl: publicUrl,
		allowedHosts: list(env.AQ_ALLOWED_HOSTS),
		allowedOrigins,
		dbFile: join(dataDir, "agent-questions.sqlite"),
		uiDir: env.AQ_UI_DIR ?? defaultUiDir(here),
		defaultWaitSeconds: parseWaitSeconds(env),
		// A shared server never opens a browser: it would be a side effect any member could trigger.
		noOpen: deploymentMode === "server" || env.AQ_NO_OPEN === "1",
		dev: env.AQ_DEV === "1",
		trustProxy: parseTrustProxy(env),
		logLevel: parseLogLevel(env),
		admin,
	};
}
