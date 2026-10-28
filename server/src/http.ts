import fastifyStatic from "@fastify/static";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import Fastify, { type FastifyInstance } from "fastify";
import { existsSync } from "node:fs";
import type { AppConfig } from "./config.js";
import { createMcpServer } from "./mcp.js";
import { AnswersSchema } from "./schema.js";
import { HttpError, type Session, type SessionStore } from "./sessions.js";

const view = (s: Session) => ({
	id: s.id,
	title: s.title,
	status: s.status,
	revision: s.revision,
	questions: s.questions,
	draft: s.draft,
	answers: s.answers,
	declineReason: s.declineReason,
});

export async function buildApp(store: SessionStore, cfg: AppConfig): Promise<FastifyInstance> {
	const app = Fastify({ logger: { level: process.env.AQ_LOG ?? "info" } });

	// Protection contre le DNS rebinding et les requêtes cross-origin (cf. spec MCP, transport Streamable HTTP).
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

	app.setErrorHandler((err, _req, reply) => {
		if (err instanceof HttpError) {
			return reply.code(err.status).send({ error: err.message, details: err.details });
		}
		return reply.send(err);
	});

	// ---- API de l'UI -------------------------------------------------------
	app.get("/api/sessions", async () =>
		store.listOpen().map((s) => ({
			id: s.id,
			title: s.title,
			createdAt: s.createdAt,
			questionCount: s.questions.length,
		})),
	);

	app.get<{ Params: { id: string } }>("/api/sessions/:id", async (req) => {
		const s = store.get(req.params.id);
		if (!s) throw new HttpError(404, "Session introuvable");
		store.touch(s.id);
		return view(s);
	});

	app.put<{ Params: { id: string } }>("/api/sessions/:id/draft", async (req) => {
		const parsed = AnswersSchema.safeParse(req.body);
		if (!parsed.success) throw new HttpError(400, "Brouillon invalide");
		store.saveDraft(req.params.id, parsed.data);
		return { ok: true };
	});

	app.post<{ Params: { id: string } }>("/api/sessions/:id/answers", async (req) => {
		const parsed = AnswersSchema.safeParse(req.body);
		if (!parsed.success) throw new HttpError(400, "Réponses invalides");
		store.submit(req.params.id, parsed.data);
		return { ok: true };
	});

	app.post<{ Params: { id: string }; Body: { reason?: string } }>("/api/sessions/:id/decline", async (req) => {
		store.decline(req.params.id, (req.body?.reason ?? "").slice(0, 2000));
		return { ok: true };
	});

	// ---- Endpoint MCP (Streamable HTTP, sans état : un serveur par requête) -----
	app.post("/mcp", async (req, reply) => {
		const server = createMcpServer(store, cfg);
		const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
		reply.hijack();
		reply.raw.on("close", () => {
			void transport.close();
			void server.close();
		});
		await server.connect(transport);
		await transport.handleRequest(req.raw, reply.raw, req.body);
	});
	const notAllowed = async (_req: unknown, reply: { code: (n: number) => { send: (b: unknown) => unknown } }) =>
		reply.code(405).send({ error: "Méthode non supportée : serveur MCP sans état, utilisez POST" });
	app.get("/mcp", notAllowed);
	app.delete("/mcp", notAllowed);

	// ---- UI Angular (build statique) + fallback SPA -------------------------
	if (existsSync(cfg.uiDir)) {
		await app.register(fastifyStatic, { root: cfg.uiDir });
		app.setNotFoundHandler((req, reply) => {
			if (req.method === "GET" && !req.url.startsWith("/api") && !req.url.startsWith("/mcp")) {
				return reply.sendFile("index.html");
			}
			return reply.code(404).send({ error: "Introuvable" });
		});
	} else {
		app.get("/", async () => "UI non construite. Lancez : npm run build -w ui");
	}

	app.get("/health", (req, reply) => {
		reply.code(200).send({ Status: "Agent question API is running" });
	});

	return app;
}
