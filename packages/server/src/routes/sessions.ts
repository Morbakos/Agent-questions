import type { FastifyInstance } from "fastify";
import { AnswersSchema, type SessionHistory } from "@agent-questions/shared";
import { HttpError, type SessionStore } from "../session-store.js";
import { summary, view } from "./views.js";

/** Taille d'une page de l'historique. */
export const HISTORY_PAGE_SIZE = 50;

/** API de l'UI : liste, historique, lecture, brouillon, réponses et refus d'une session. */
export function registerSessionRoutes(app: FastifyInstance, store: SessionStore): void {
	app.get("/api/sessions", async () => store.listOpen().map(summary));

	app.get<{ Querystring: { before?: string } }>("/api/sessions/history", async (req): Promise<SessionHistory> => {
		const before = req.query.before === undefined ? undefined : Number(req.query.before);
		if (before !== undefined && !Number.isFinite(before)) {
			throw new HttpError(400, "Curseur invalide");
		}
		const page = store.listClosed(HISTORY_PAGE_SIZE, before);
		return { items: page.items.map(summary), nextBefore: page.nextBefore };
	});

	app.get<{ Params: { id: string } }>("/api/sessions/:id", async (req) => {
		const s = store.get(req.params.id);
		if (!s) {
			throw new HttpError(404, "Session introuvable");
		}
		store.touch(s.id);
		return view(s);
	});

	app.put<{ Params: { id: string } }>("/api/sessions/:id/draft", async (req) => {
		const parsed = AnswersSchema.safeParse(req.body);
		if (!parsed.success) {
			throw new HttpError(400, "Brouillon invalide");
		}
		store.saveDraft(req.params.id, parsed.data);
		return { ok: true };
	});

	app.post<{ Params: { id: string } }>("/api/sessions/:id/answers", async (req) => {
		const parsed = AnswersSchema.safeParse(req.body);
		if (!parsed.success) {
			throw new HttpError(400, "Réponses invalides");
		}
		store.submit(req.params.id, parsed.data);
		return { ok: true };
	});

	app.post<{ Params: { id: string }; Body: { reason?: string } }>("/api/sessions/:id/decline", async (req) => {
		store.decline(req.params.id, (req.body?.reason ?? "").slice(0, 2000));
		return { ok: true };
	});
}
