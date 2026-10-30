import Fastify, { type FastifyInstance } from "fastify";
import type { AppConfig } from "./config.js";
import { registerGuard } from "./routes/guard.js";
import { registerMcpRoutes } from "./routes/mcp.js";
import { registerSessionRoutes } from "./routes/sessions.js";
import { registerStaticUi } from "./routes/static.js";
import { HttpError, type SessionStore } from "./session-store.js";

/** Assemble l'application Fastify : garde Host/Origin, API de l'UI, endpoint MCP, UI statique, `/health`. */
export async function buildApp(store: SessionStore, cfg: AppConfig): Promise<FastifyInstance> {
	const app = Fastify({ logger: { level: process.env.AQ_LOG ?? "info" } });

	registerGuard(app, cfg);

	app.setErrorHandler((err, _req, reply) => {
		if (err instanceof HttpError) {
			return reply.code(err.status).send({ error: err.message, details: err.details });
		}
		return reply.send(err);
	});

	registerSessionRoutes(app, store);
	registerMcpRoutes(app, store, cfg);
	await registerStaticUi(app, cfg);

	app.get("/health", (_req, reply) => {
		reply.code(200).send({ Status: "Agent question API is running" });
	});

	return app;
}
