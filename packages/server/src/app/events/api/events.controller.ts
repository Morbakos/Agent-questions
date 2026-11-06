import { Controller, Inject, type MessageEvent, Sse } from "@nestjs/common";
import { CurrentSession, type SessionRecord } from "@nestjs/authentication";
import type { Observable } from "rxjs";
import { CurrentPrincipal } from "@app/auth/api/current-principal.js";
import { SessionOnly } from "@app/auth/api/session-only.decorator.js";
import type { Principal } from "@app/auth/domain/principal.js";
import { UiHub } from "@app/events/ui-hub.js";

/** Stream of UI events (Nest's `@Sse()`): announces new sessions, closed on sign-out. */
@SessionOnly()
@Controller("api/events")
export class EventsController {
	constructor(@Inject(UiHub) private readonly hub: UiHub) {}

	@Sse()
	events(
		@CurrentPrincipal() principal: Principal,
		@CurrentSession() session: SessionRecord | null,
	): Observable<MessageEvent> {
		return this.hub.stream(principal.userId, session?.id ?? null, session?.expiresAt);
	}
}
