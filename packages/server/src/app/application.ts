import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { AuthErrorFilter } from "@app/auth/auth-error.js";
import type { AppConfig } from "@app/config/config.js";
import { loadConfig } from "@app/config/config.js";
import { AppModule } from "./app.module.js";
import type { CoreOptions } from "@app/core/core.module.js";
import { HttpErrorFilter } from "@app/http/http-error.filter.js";
import { configureHttp } from "@app/http/http-setup.js";
import { originsOf } from "@app/http/allowed.js";
import { nestLogLevels } from "@app/http/log-levels.js";
import { redactUrl } from "@app/http/redact-url.js";
import { securityHeadersOf } from "@app/http/security-headers.js";
import { trustedOriginsOf } from "@app/http/trusted-origins.js";

export { redactUrl };

export type ApplicationOptions = CoreOptions;

/**
 * Maximum request body size (10 MiB, Fastify's default is 1 MiB). The worst case allowed by `QuestionSchema` is about
 * 8 MB (30 questions, each with up to 200 000 characters of context, a 20 000-character prompt and 20 options), so
 * the default would reject payloads the schema accepts. A reverse proxy in front must allow at least this size.
 */
export const BODY_LIMIT_BYTES = 10 * 1024 * 1024;

/**
 * Fastify adapter of the application: proxy trust, and **no logger of its own** (`logger: false`). Everything goes
 * through Nest's `Logger`, set by `AQ_LOG` (`nestLogLevels`): one format, one setting. Requests are logged by
 * `http-setup.ts`, with their URL redacted (`redactUrl`).
 */
export function createFastifyAdapter({ trustProxy }: AppConfig): FastifyAdapter {
	return new FastifyAdapter({
		bodyLimit: BODY_LIMIT_BYTES,
		// Number of trusted hops: only the last `trustProxy` proxies may set the client address.
		trustProxy: trustProxy > 0 ? (_address: string, hop: number) => hop < trustProxy : false,
		logger: false,
	});
}

/**
 * Settings applied to the application once created: global error filters, the HTTP guard (Host/Origin, CORS, security
 * headers) and the static UI. Shared by `main.ts` and the e2e tests, which thus mount exactly the same application
 * (`Test.createTestingModule(...).createNestApplication(...)` does not apply them on its own).
 */
export async function setupApplication(app: NestFastifyApplication, config: AppConfig): Promise<void> {
	app.useLogger(nestLogLevels(config.logLevel));
	app.useGlobalFilters(new HttpErrorFilter(), new AuthErrorFilter());
	// CSRF: a write that a browser declares as coming from another origin is refused (403). Clients without a browser
	// (MCP agents, curl) send neither `Sec-Fetch-Site` nor `Origin` and get through.
	app.enableCsrfProtection({ trustedOrigins: trustedOriginsOf(config) });
	app.useSecurityHeaders(securityHeadersOf(config));
	app.enableCors({
		origin: [...originsOf(config)],
		credentials: true,
		methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
		allowedHeaders: [
			"content-type",
			"accept",
			"authorization",
			"mcp-protocol-version",
			"mcp-session-id",
			"last-event-id",
		],
		maxAge: 600,
	});
	await configureHttp(app, config);
}

/** Creates the full application (module graph, Fastify adapter and `setupApplication`). Does not listen: the caller does. */
export async function createApplication(options: ApplicationOptions = {}): Promise<NestFastifyApplication> {
	const { config = loadConfig() } = options;
	const app = await NestFactory.create<NestFastifyApplication>(
		AppModule.register({ ...options, config }),
		createFastifyAdapter(config),
		{ logger: nestLogLevels(config.logLevel) },
	);
	await setupApplication(app, config);
	return app;
}
