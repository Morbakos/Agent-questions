import { Inject, Injectable } from "@nestjs/common";
import { ApiKeyProvider, AuthenticationRegistry } from "@nestjs/authentication";
import type { ConfigType } from "@nestjs/config";
import { appConfig } from "@app/config/app.config.js";
import { type Principal, toPrincipal } from "@app/auth/domain/principal.js";
import { UserRepository } from "@app/auth/persistence/user.repository.js";

/** Prefix of API tokens (`aq_<id>_<secret>`): tells them apart from a cookie and lets secret scanners spot them. */
export const API_KEY_PREFIX = "aq";

/**
 * MCP clients' API tokens (`Authorization: Bearer aq_…`): server profile only. The package compares the hash of the
 * whole key in constant time; here we look the key up by its public id and refuse that of a disabled account.
 * `generate()` is used by `AccountsService` to create a key.
 */
@Injectable()
export class ApiKeyAuth extends ApiKeyProvider<Principal> {
	constructor(
		@Inject(AuthenticationRegistry) registry: AuthenticationRegistry,
		@Inject(UserRepository) private readonly users: UserRepository,
		@Inject(appConfig.KEY) { deploymentMode }: ConfigType<typeof appConfig>,
	) {
		super({ prefix: API_KEY_PREFIX, realm: "agent-questions" });
		if (deploymentMode === "server") {
			registry.registerProvider(this, { order: 1 });
		}
	}

	protected async findKey(id: string) {
		const stored = await this.users.findApiKey(id);
		if (!stored || stored.user.disabled) {
			return null;
		}
		return {
			hash: stored.tokenHash,
			user: toPrincipal(stored.user),
			expiresAt: stored.expiresAt === null ? null : new Date(stored.expiresAt),
		};
	}
}
