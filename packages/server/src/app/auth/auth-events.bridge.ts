import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { AuthenticationEvents } from "@nestjs/authentication";
import type { Subscription } from "rxjs";
import { UiHub } from "@app/events/ui-hub.js";

/**
 * Closes a session's SSE streams when it ends: `@nestjs/authentication` publishes `sign-out` (sign-out, revocation of a
 * session, "sign out everywhere"), and the stream opened with that session must not outlive it.
 */
@Injectable()
export class AuthEventsBridge implements OnModuleInit, OnModuleDestroy {
	private subscription: Subscription | undefined;

	constructor(
		@Inject(AuthenticationEvents) private readonly events: AuthenticationEvents,
		@Inject(UiHub) private readonly hub: UiHub,
	) {}

	onModuleInit(): void {
		this.subscription = this.events.events$.subscribe((event) => {
			if (event.type !== "sign-out") {
				return;
			}
			if (event.everywhere) {
				this.hub.closeUser(event.userId);
			} else if (event.sessionId) {
				this.hub.closeSession(event.sessionId);
			}
		});
	}

	onModuleDestroy(): void {
		this.subscription?.unsubscribe();
	}
}
