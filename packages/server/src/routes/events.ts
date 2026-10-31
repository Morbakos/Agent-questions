import type { FastifyInstance } from "fastify";
import type { UiHub } from "../ui-hub.js";

/** Intervalle des commentaires SSE qui maintiennent la connexion ouverte (proxys, navigateur). */
const KEEPALIVE_MS = 15_000;

/** Flux SSE de l'UI : informe l'onglet ouvert qu'il doit aller sur une session nouvelle ou modifiée. */
export function registerEventRoutes(app: FastifyInstance, hub: UiHub): void {
	app.get("/api/events", (_req, reply) => {
		// hijack : la connexion reste ouverte ; les en-têtes CORS posés par la garde sont sur reply.raw.
		reply.hijack();
		const res = reply.raw;
		res.writeHead(200, {
			"content-type": "text/event-stream",
			"cache-control": "no-cache",
			connection: "keep-alive",
		});
		res.write(": connecté\n\n");
		hub.add(res);
		const keepalive = setInterval(() => res.write(": keepalive\n\n"), KEEPALIVE_MS);
		res.on("close", () => clearInterval(keepalive));
	});
}
