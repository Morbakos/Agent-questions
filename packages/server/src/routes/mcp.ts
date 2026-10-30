import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { AppConfig } from "../config.js";
import { createMcpServer } from "../mcp.js";
import type { SessionStore } from "../session-store.js";

/** Endpoint MCP (Streamable HTTP, sans état : un serveur et un transport par requête). */
export function registerMcpRoutes(app: FastifyInstance, store: SessionStore, cfg: AppConfig): void {
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

	const notAllowed = async (_req: unknown, reply: FastifyReply) =>
		reply.code(405).send({ error: "Méthode non supportée : serveur MCP sans état, utilisez POST" });
	app.get("/mcp", notAllowed);
	app.delete("/mcp", notAllowed);
}
