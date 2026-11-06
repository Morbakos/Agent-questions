import { Controller, Get, Inject, Logger, Param, Query } from "@nestjs/common";
import type { AdminSessionPage, AdminSessionView } from "@agent-questions/shared";
import { CurrentPrincipal } from "@app/auth/api/current-principal.js";
import { Roles } from "@app/auth/api/roles.decorator.js";
import { SessionOnly } from "@app/auth/api/session-only.decorator.js";
import type { Principal } from "@app/auth/domain/principal.js";
import { UserRepository } from "@app/auth/persistence/user.repository.js";
import { parseCursor } from "@app/http/cursor.js";
import { HttpError } from "@app/http/http-error.js";
import { SessionsService } from "@app/sessions/sessions.service.js";
import { summary, view } from "./views.js";

const PAGE_SIZE = 50;

/**
 * Supervision: an administrator **sees** every user's sessions, but cannot answer them. There are only read routes
 * here; the write routes (`/api/sessions/:id/…`) stay limited to the owner.
 */
@SessionOnly()
@Roles("admin")
@Controller("api/admin/sessions")
export class AdminSessionsController {
	private readonly logger = new Logger("supervision");

	constructor(
		@Inject(SessionsService) private readonly sessions: SessionsService,
		@Inject(UserRepository) private readonly users: UserRepository,
	) {}

	private async ownerName(ownerId: string): Promise<string> {
		return (await this.users.get(ownerId))?.username ?? ownerId;
	}

	@Get()
	async list(@CurrentPrincipal() admin: Principal, @Query("before") before?: string): Promise<AdminSessionPage> {
		this.logger.log(`${admin.username} consulte la liste des sessions de tous les utilisateurs`);
		const cursor = parseCursor(before);
		const page = await this.sessions.listAll(PAGE_SIZE, cursor);
		const items = await Promise.all(
			page.items.map(async (session) => ({
				...summary(session),
				ownerId: session.ownerId,
				ownerUsername: await this.ownerName(session.ownerId),
			})),
		);
		return { items, nextBefore: page.nextBefore };
	}

	@Get(":id")
	async get(@CurrentPrincipal() admin: Principal, @Param("id") id: string): Promise<AdminSessionView> {
		this.logger.log(`${admin.username} consulte la session ${id}`);
		const session = await this.sessions.getAny(id);
		if (!session) {
			throw new HttpError(404, "Session introuvable");
		}
		return {
			...view(session),
			readOnly: true,
			ownerId: session.ownerId,
			ownerUsername: await this.ownerName(session.ownerId),
		};
	}
}
