import { Logger } from "@nestjs/common";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type { FastifyInstance } from "fastify";
import type { AppConfig } from "@app/config/config.js";
import { hostsOf, originsOf } from "@app/http/allowed.js";
import { redactUrl } from "@app/http/redact-url.js";

/**
 * Installs the HTTP guard on Fastify (the Angular UI is served by `@nestjs/serve-static`, see `AppModule`).
 *
 * Registers Fastify hooks: Host/Origin check (403, runs before everything else, `/health` included), `no-store` on
 * `/api` and `/auth`, and request/denial logging. A request without `Origin` (non-browser client) passes.
 */
export async function configureHttp(app: NestFastifyApplication, config: AppConfig): Promise<void> {
	const fastify = app.getHttpAdapter().getInstance() as FastifyInstance;
	const hosts = hostsOf(config);
	const origins = originsOf(config);

	// Security headers (nosniff, anti-framing, referrer, CSP, HSTS) are set by `app.useSecurityHeaders()`
	// (`application.ts`). What remains is `no-store` on the API and authentication, which no Nest package sets globally.
	fastify.addHook("onSend", async (request, reply) => {
		if (/^\/(api|auth)\//.test(request.url)) {
			reply.header("cache-control", "no-store");
		}
	});

	// Authentication (401) or permission (403) refusals: logged with the method and path, never the token, the
	// cookie or the password. `@nestjs/authentication` does not log its refusals.
	const audit = new Logger("auth");
	// Every request except `/health` (probed in a loop), at `debug` level: the URL is redacted (invitation token).
	// Successful `/mcp` calls do not appear: `@nestjs/mcp` does `reply.hijack()`, so Fastify does not emit `onResponse`;
	// the tools log their own waits (`[mcp]`).
	const requests = new Logger("http");
	fastify.addHook("onResponse", async (request, reply) => {
		const path = redactUrl(request.url.split("?")[0]);
		if (reply.statusCode === 401 || reply.statusCode === 403) {
			audit.warn(`${reply.statusCode} ${request.method} ${path}`);
		}
		if (path !== "/health") {
			requests.debug(`${request.method} ${path} ${reply.statusCode} ${Math.round(reply.elapsedTime)}ms`);
		}
	});

	// DNS rebinding guard: `Host` and `Origin` must be known (403 otherwise). The CORS headers of accepted origins
	// come from `app.enableCors()` (`application.ts`).
	fastify.addHook("onRequest", async (request, reply) => {
		if (!hosts.has(request.headers.host ?? "")) {
			return reply.code(403).send({ error: "Host non autorisé" });
		}
		const origin = request.headers.origin;
		if (origin && !origins.has(origin)) {
			return reply.code(403).send({ error: "Origin non autorisée" });
		}
	});
}
