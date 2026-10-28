import type { FastifyInstance } from "fastify";
import { AnswersSchema } from "@agent-questions/shared";
import { HttpError, type SessionStore } from "../sessions.js";
import { summary, view } from "./views.js";

/** API de l'UI : liste, lecture, brouillon, réponses et refus d'une session. */
export function registerSessionRoutes(app: FastifyInstance, store: SessionStore): void {
	app.get("/api/sessions", async () => store.listOpen().map(summary));

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
}
