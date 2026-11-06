import { Inject, Injectable } from "@nestjs/common";
import { AuthenticationRegistry, type SessionRecord, SessionCookieProvider } from "@nestjs/authentication";
import type { ConfigType } from "@nestjs/config";
import { appConfig } from "@app/config/app.config.js";
import { type Principal, toPrincipal } from "@app/auth/domain/principal.js";

/**
 * Identity by session cookie (browser): server profile only. The account comes from the same read as the session
 * (`MikroAuthSessionStore.getSession`); a disabled or deleted account ends the session.
 */
@Injectable()
export class SessionAuth extends SessionCookieProvider<Principal> {
	constructor(
		@Inject(AuthenticationRegistry) registry: AuthenticationRegistry,
		@Inject(appConfig.KEY) { deploymentMode }: ConfigType<typeof appConfig>,
	) {
		super();
		if (deploymentMode === "server") {
			registry.registerProvider(this, { order: 0 });
		}
	}

	protected validate({ extra }: SessionRecord): Principal | null {
		const user = extra?.user;
		return user && !user.disabled ? toPrincipal(user) : null;
	}
}
