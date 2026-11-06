import { Inject, Injectable } from "@nestjs/common";
import { AuthenticationProvider, AuthenticationRegistry } from "@nestjs/authentication";
import type { ConfigType } from "@nestjs/config";
import { appConfig } from "@app/config/app.config.js";
import { LOCAL_PRINCIPAL, type Principal } from "@app/auth/domain/principal.js";

/**
 * Local profile: a single user on their machine, with no account or username. Registered only in this profile
 * (the server then listens on loopback only, `config.ts`); it answers any request with the local user.
 */
@Injectable()
export class LocalAuth extends AuthenticationProvider<Principal> {
	constructor(
		@Inject(AuthenticationRegistry) registry: AuthenticationRegistry,
		@Inject(appConfig.KEY) { deploymentMode }: ConfigType<typeof appConfig>,
	) {
		super();
		if (deploymentMode === "local") {
			registry.registerProvider(this, { order: 0 });
		}
	}

	authenticate() {
		return { user: LOCAL_PRINCIPAL };
	}
}
