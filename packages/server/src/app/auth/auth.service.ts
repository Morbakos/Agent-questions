import { randomBytes } from "node:crypto";
import { Inject, Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import { PasswordHasher } from "@nestjs/authentication";
import type { ConfigType } from "@nestjs/config";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@agent-questions/shared";
import { appConfig } from "@app/config/app.config.js";
import { ConfigError } from "@app/config/config.js";
import { LOCAL_USER_ID } from "@app/auth/domain/principal.js";
import { UserRepository } from "@app/auth/persistence/user.repository.js";
import { SessionRepository } from "@app/sessions/persistence/session.repository.js";
import { AuthError } from "./auth-error.js";
import { LoginThrottle } from "./login-throttle.js";

const BAD_CREDENTIALS = "Identifiant ou mot de passe incorrect";

/**
 * Credential verification and creation of the first administrator. Sessions, cookies, API tokens and CSRF are those of
 * `@nestjs/authentication` (`SignInService`, `SessionAuth`, `ApiKeyAuth`).
 */
@Injectable()
export class AuthService implements OnApplicationBootstrap {
	private readonly logger = new Logger("auth");
	private readonly throttle = new LoginThrottle();

	constructor(
		@Inject(appConfig.KEY) private readonly config: ConfigType<typeof appConfig>,
		@Inject(UserRepository) private readonly users: UserRepository,
		@Inject(SessionRepository) private readonly sessions: SessionRepository,
		@Inject(PasswordHasher) private readonly hasher: PasswordHasher,
	) {}

	/** Deployment profile, exposed by `GET /auth/me`. */
	get mode(): ConfigType<typeof appConfig>["deploymentMode"] {
		return this.config.deploymentMode;
	}

	/** After all `onModuleInit` hooks: the database is then migrated (`StorageBootstrap`). */
	async onApplicationBootstrap(): Promise<void> {
		await this.bootstrapAdmin();
	}

	/** First start of the server profile: with no account at all, nobody could sign in. */
	private async bootstrapAdmin(): Promise<void> {
		if (this.config.deploymentMode !== "server" || (await this.users.count()) > 0) {
			return;
		}
		const username = this.config.admin?.username ?? "admin";
		const configured = this.config.admin?.password ?? null;
		if (
			configured !== null &&
			(configured.length < PASSWORD_MIN_LENGTH || configured.length > PASSWORD_MAX_LENGTH)
		) {
			// Checked here, not in `loadConfig`: the value is only used (and so only matters) when the first admin is created.
			throw new ConfigError(
				`AQ_ADMIN_PASSWORD must be between ${PASSWORD_MIN_LENGTH} and ${PASSWORD_MAX_LENGTH} characters long.`,
			);
		}
		const password = configured ?? randomBytes(15).toString("base64url");
		const admin = await this.users.create({
			username,
			role: "admin",
			passwordHash: await this.hasher.hash(password),
		});
		// Sessions predating accounts (local profile) go to the first administrator.
		const adopted = await this.sessions.reassignOwner(LOCAL_USER_ID, admin.id);
		if (adopted > 0) {
			this.logger.log(`${adopted} session(s) existante(s) rattachée(s) à « ${username} ».`);
		}
		if (configured) {
			this.logger.log(`Compte administrateur « ${username} » créé.`);
		} else {
			// Shown only once: only its hash is kept.
			this.logger.warn(
				`Compte administrateur créé : identifiant « ${username} », mot de passe « ${password} ». ` +
					"Notez-le et changez-le après la première connexion (ou définissez AQ_ADMIN_PASSWORD avant le premier démarrage).",
			);
		}
	}

	/**
	 * Verifies username and password and returns the account id; the caller opens the session
	 * (`SignInService.signIn`). Limited to 10 failures / 15 min per username and per IP. An unknown or disabled account,
	 * or one without a password (pending invitation), costs the same time as a wrong password: `PasswordHasher.verify`
	 * then does a dummy check.
	 */
	async verifyCredentials(username: string, password: string, ip: string): Promise<string> {
		const keys = [`user:${username.toLowerCase()}`, `ip:${ip}`];
		this.throttle.attempt(keys);
		const user = await this.users.findByUsername(username);
		const hash = user && !user.disabled ? user.passwordHash : null;
		const valid = await this.hasher.verify(password, hash);
		if (!user || !valid) {
			throw new AuthError(401, BAD_CREDENTIALS);
		}
		this.throttle.forgive(keys[0] ?? "", keys[1] ?? "");
		return user.id;
	}
}
