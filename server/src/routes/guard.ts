import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../config.js";

/** Protection contre le DNS rebinding et les requêtes cross-origin (cf. spec MCP, transport Streamable HTTP). */
export function registerGuard(app: FastifyInstance, cfg: AppConfig): void {
	const hosts = new Set(
		["127.0.0.1", "localhost", ...cfg.allowedHosts].map((h) => (h.includes(":") ? h : `${h}:${cfg.port}`)),
	);
	const origins = new Set([...hosts].map((h) => `http://${h}`));
	if (cfg.dev) {
		origins.add("http://localhost:4200");
		origins.add("http://127.0.0.1:4200");
	}
	// Origines supplémentaires autorisées (ex. l'UI de llama-server), séparées par des virgules.
	// Toujours des origines précises : jamais "*", ce serveur n'a pas d'authentification.
	for (const o of (process.env.AQ_ALLOWED_ORIGINS ?? "").split(",")) {
		if (o.trim()) origins.add(o.trim());
	}

	app.addHook("onRequest", async (req, reply) => {
		if (!hosts.has(req.headers.host ?? "")) {
			return reply.code(403).send({ error: "Host non autorisé" });
		}
		const origin = req.headers.origin;
		if (origin && !origins.has(origin)) {
			return reply.code(403).send({ error: "Origin non autorisée" });
		}
		if (origin) {
			// CORS uniquement pour les origines autorisées.
			// reply.raw : la route /mcp fait reply.hijack(), donc on pose les en-têtes sur la réponse Node.
			reply.raw.setHeader("access-control-allow-origin", origin);
			reply.raw.setHeader("vary", "Origin");
			if (req.method === "OPTIONS") {
				reply.raw.setHeader("access-control-allow-methods", "GET, POST, DELETE, OPTIONS");
				reply.raw.setHeader(
					"access-control-allow-headers",
					"content-type, accept, mcp-protocol-version, mcp-session-id, last-event-id",
				);
				reply.raw.setHeader("access-control-max-age", "600");
				return reply.code(204).send();
			}
		}
	});
}
