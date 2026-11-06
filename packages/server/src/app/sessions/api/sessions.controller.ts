import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put, Query } from "@nestjs/common";
import { AnswersSchema, DeclineSchema, type SessionHistory } from "@agent-questions/shared";
import { CurrentPrincipal } from "@app/auth/api/current-principal.js";
import { SessionOnly } from "@app/auth/api/session-only.decorator.js";
import type { Principal } from "@app/auth/domain/principal.js";
import { parseCursor } from "@app/http/cursor.js";
import { HttpError } from "@app/http/http-error.js";
import { SessionsService } from "@app/sessions/sessions.service.js";
import { summary, view } from "./views.js";

const HISTORY_PAGE_SIZE = 50;

/** A user's UI sees only their own sessions: the owner comes from the authenticated principal. */
@SessionOnly()
@Controller("api/sessions")
export class SessionsController {
	constructor(@Inject(SessionsService) private readonly sessions: SessionsService) {}

	@Get()
	async listOpen(@CurrentPrincipal() principal: Principal) {
		return (await this.sessions.listOpen(principal.userId)).map(summary);
	}

	@Get("history")
	async history(@CurrentPrincipal() principal: Principal, @Query("before") before?: string): Promise<SessionHistory> {
		const cursor = parseCursor(before);
		const page = await this.sessions.listClosed(principal.userId, HISTORY_PAGE_SIZE, cursor);
		return { items: page.items.map(summary), nextBefore: page.nextBefore };
	}

	@Get(":id")
	async get(@CurrentPrincipal() principal: Principal, @Param("id") id: string) {
		const session = await this.sessions.get(principal.userId, id);
		if (!session) {
			throw new HttpError(404, "Session introuvable");
		}
		return view(session);
	}

	@Put(":id/draft")
	async saveDraft(@CurrentPrincipal() principal: Principal, @Param("id") id: string, @Body() body: unknown) {
		const parsed = AnswersSchema.safeParse(body);
		if (!parsed.success) {
			throw new HttpError(400, "Brouillon invalide");
		}
		await this.sessions.saveDraft(principal.userId, id, parsed.data);
		return { ok: true };
	}

	@HttpCode(200)
	@Post(":id/answers")
	async submit(@CurrentPrincipal() principal: Principal, @Param("id") id: string, @Body() body: unknown) {
		const parsed = AnswersSchema.safeParse(body);
		if (!parsed.success) {
			throw new HttpError(400, "Réponses invalides");
		}
		await this.sessions.submit(principal.userId, id, parsed.data);
		return { ok: true };
	}

	@HttpCode(200)
	@Post(":id/decline")
	async decline(@CurrentPrincipal() principal: Principal, @Param("id") id: string, @Body() body: unknown) {
		const parsed = DeclineSchema.safeParse(body ?? {});
		if (!parsed.success) {
			throw new HttpError(400, "Refus invalide");
		}
		await this.sessions.decline(principal.userId, id, parsed.data.reason);
		return { ok: true };
	}
}
