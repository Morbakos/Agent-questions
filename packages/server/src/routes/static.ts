import fastifyStatic from "@fastify/static";
import type { FastifyInstance } from "fastify";
import { existsSync } from "node:fs";
import type { AppConfig } from "../config.js";

/** UI Angular (build statique) avec repli sur `index.html` pour les routes de l'application. */
export async function registerStaticUi(app: FastifyInstance, cfg: AppConfig): Promise<void> {
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
}
