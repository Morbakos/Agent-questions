import { type DynamicModule, Module } from "@nestjs/common";
import { AuthenticationModule } from "@nestjs/authentication";
import { AccountController, AdminUsersController } from "@app/auth/api/accounts.controller.js";
import { AuthController } from "@app/auth/api/auth.controller.js";
import { MikroAuthSessionStore } from "@app/auth/persistence/mikro-auth-session.store.js";
import { ApiKeyAuth } from "@app/auth/providers/api-key-auth.js";
import { LocalAuth } from "@app/auth/providers/local-auth.js";
import { SessionAuth } from "@app/auth/providers/session-auth.js";
import type { AppConfig } from "@app/config/config.js";
import { trustedOriginsOf } from "@app/http/trusted-origins.js";
import { AccountsService } from "./accounts.service.js";
import { AuthEventsBridge } from "./auth-events.bridge.js";
import { AuthService } from "./auth.service.js";

/**
 * Authentication: `@nestjs/authentication` (cookie sessions, API tokens, CSRF, global guard) configured for this
 * repository. Accounts, invitations and roles remain ours (`AccountsService`). Dynamic module: providers are
 * registered according to the profile (`SessionAuth` and `ApiKeyAuth` in server, `LocalAuth` in local) and the cookie
 * depends on `baseUrl` (`__Host-sid` requires HTTPS; over HTTP outside localhost the cookie is named `sid`).
 */
@Module({})
export class AuthModule {
	static register(config: AppConfig): DynamicModule {
		return {
			module: AuthModule,
			imports: [
				AuthenticationModule.forRoot({
					session: {
						absoluteTtl: "7d",
						idleTtl: "1d",
						cookie: { secure: config.baseUrl.startsWith("https:") },
						trustedOrigins: trustedOriginsOf(config),
					},
				}),
			],
			controllers: [AuthController, AccountController, AdminUsersController],
			providers: [
				AuthService,
				AccountsService,
				AuthEventsBridge,
				MikroAuthSessionStore,
				SessionAuth,
				ApiKeyAuth,
				LocalAuth,
			],
			exports: [AuthService, AccountsService],
		};
	}
}
