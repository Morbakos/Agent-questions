import { Inject, Injectable } from "@nestjs/common";
import { PasswordHasher, SessionService } from "@nestjs/authentication";
import type { ConfigType } from "@nestjs/config";
import type {
	ApiTokenSummary,
	CreatedApiToken,
	InvitationInfo,
	Role,
	UserInvitation,
	UserSummary,
} from "@agent-questions/shared";
import { appConfig } from "@app/config/app.config.js";
import { UiHub } from "@app/events/ui-hub.js";
import { HttpError } from "@app/http/http-error.js";
import type { Principal } from "@app/auth/domain/principal.js";
import type { UserRecord } from "@app/auth/domain/user.js";
import { UserRepository } from "@app/auth/persistence/user.repository.js";
import { ApiKeyAuth } from "@app/auth/providers/api-key-auth.js";
import { AuthError } from "./auth-error.js";
import { LoginThrottle } from "./login-throttle.js";
import { hashSecret, randomSecret } from "./tokens.js";

/** Validity of an invitation link, in milliseconds (7 days). */
const INVITATION_TTL_MS = 7 * 24 * 3_600_000;
const MAX_TOKENS_PER_USER = 20;
/** An API token expires after one year: a forgotten key does not work forever. */
const API_KEY_TTL_MS = 365 * 24 * 3_600_000;

/** Public projection of an account: never exposes the hash, only `pending` (no password chosen yet). */
export const toSummary = ({ id, username, role, disabled, passwordHash, createdAt }: UserRecord): UserSummary => ({
	id,
	username,
	role,
	disabled,
	pending: passwordHash === null,
	createdAt,
});

/** Account management (administrator), invitations and the signed-in user's own account. Server profile only. */
@Injectable()
export class AccountsService {
	private readonly throttle = new LoginThrottle();

	constructor(
		@Inject(appConfig.KEY) private readonly config: ConfigType<typeof appConfig>,
		@Inject(UserRepository) private readonly users: UserRepository,
		@Inject(UiHub) private readonly hub: UiHub,
		@Inject(PasswordHasher) private readonly hasher: PasswordHasher,
		@Inject(SessionService) private readonly sessions: SessionService,
		@Inject(ApiKeyAuth) private readonly apiKeys: ApiKeyAuth,
	) {}

	/**
	 * Accounts do not exist in the local profile (a single implicit user).
	 * @throws HttpError 404 outside the server profile. Every public method calls it first.
	 */
	requireServer(): void {
		if (this.config.deploymentMode !== "server") {
			throw new HttpError(404, "Les comptes ne sont disponibles qu'en profil server");
		}
	}

	// --- Administration

	async list(): Promise<UserSummary[]> {
		this.requireServer();
		return (await this.users.list()).map(toSummary);
	}

	/** Creates a password-less account and its invitation. @throws HttpError 409 if the username is taken. */
	async createUser(username: string, role: Role): Promise<UserInvitation> {
		this.requireServer();
		const user = await this.users.create({ username, role, passwordHash: null });
		return this.invite(user);
	}

	/** Issues a new link for an existing account (expired invitation or forgotten password); the previous link stops working. */
	async invitationFor(userId: string): Promise<UserInvitation> {
		this.requireServer();
		return this.invite(await this.mustGet(userId));
	}

	/** The token appears in clear only in the returned URL; the repository gets its SHA-256 hash. */
	private async invite(user: UserRecord): Promise<UserInvitation> {
		const token = randomSecret();
		const expiresAt = Date.now() + INVITATION_TTL_MS;
		await this.users.replaceInvitation(user.id, hashSecret(token), expiresAt);
		return { user: toSummary(user), inviteUrl: `${this.config.baseUrl}/invite/${token}`, expiresAt };
	}

	/**
	 * Changes role and/or disabled flag. Invariant: at least one enabled admin must remain.
	 * Disabling an account revokes its login sessions, drops its pending invitations and closes its SSE streams. Its API
	 * tokens are refused while it is disabled; with `revokeTokens` they are also deleted (re-enabling then needs new ones).
	 * @throws HttpError 404 if unknown, 409 if it would remove the last active admin.
	 */
	async update(
		userId: string,
		{ revokeTokens, ...patch }: { role?: Role; disabled?: boolean; revokeTokens?: boolean },
	): Promise<UserSummary> {
		this.requireServer();
		const user = await this.mustGet(userId);
		const staysAdmin = (patch.role ?? user.role) === "admin" && !(patch.disabled ?? user.disabled);
		if (user.role === "admin" && !user.disabled && !staysAdmin && (await this.users.enabledAdminCount()) <= 1) {
			throw new HttpError(409, "Il doit rester au moins un administrateur actif");
		}
		await this.users.update(userId, patch);
		if (patch.disabled) {
			await this.sessions.revokeAll(userId);
			await this.users.deleteInvitationsOf(userId);
			if (revokeTokens) {
				await this.users.deleteApiTokensOf(userId);
			}
			this.hub.closeUser(userId);
		}
		return toSummary(await this.mustGet(userId));
	}

	private async mustGet(userId: string): Promise<UserRecord> {
		const user = await this.users.get(userId);
		if (!user) {
			throw new HttpError(404, "Compte introuvable");
		}
		return user;
	}

	// --- Invitation (public: the link is the secret)

	/** @throws HttpError 404 when the link is unknown, expired, or its account is disabled (same message for all). */
	async invitationInfo(token: string): Promise<InvitationInfo> {
		return { username: (await this.userForInvitation(token)).username };
	}

	/**
	 * Sets the password chosen by the invitee and consumes the invitation.
	 *
	 * Also revokes the account's existing login sessions and closes its SSE streams; the caller signs the user in.
	 * @throws HttpError 404 for an invalid or expired link.
	 */
	async acceptInvitation(token: string, password: string): Promise<UserRecord> {
		const user = await this.userForInvitation(token);
		await this.users.update(user.id, { passwordHash: await this.hasher.hash(password) });
		await this.users.deleteInvitationsOf(user.id);
		await this.sessions.revokeAll(user.id);
		this.hub.closeUser(user.id);
		return user;
	}

	private async userForInvitation(token: string): Promise<UserRecord> {
		this.requireServer();
		const user = await this.users.findInvitation(hashSecret(token));
		if (!user || user.disabled) {
			throw new HttpError(404, "Invitation invalide ou expirée");
		}
		return user;
	}

	// --- Signed-in user's account

	/**
	 * Changes the caller's password after checking the current one (throttled per account). Every other login session
	 * and SSE stream of the user is closed; `keepSessionId` (the caller's own session) survives.
	 * @throws HttpError 429 when throttled; AuthError 403 if `current` is wrong.
	 */
	async changePassword(
		principal: Principal,
		current: string,
		next: string,
		keepSessionId: string | undefined,
	): Promise<void> {
		this.requireServer();
		const user = await this.mustGet(principal.userId);
		const key = `password:${user.id}`;
		this.throttle.attempt([key]);
		if (!(await this.hasher.verify(current, user.passwordHash))) {
			throw new AuthError(403, "Mot de passe actuel incorrect");
		}
		this.throttle.succeed([key]);
		await this.users.update(user.id, { passwordHash: await this.hasher.hash(next) });
		// A changed password closes the other sessions (lost devices, stolen sessions).
		await this.sessions.revokeAll(user.id, { except: keepSessionId });
		this.hub.closeUser(user.id, keepSessionId);
	}

	async listTokens(principal: Principal): Promise<ApiTokenSummary[]> {
		this.requireServer();
		return this.users.listApiTokens(principal.userId);
	}

	/**
	 * Creates an API token for MCP clients (`aq_<id>_<secret>`, valid one year). The clear value is in the result only:
	 * the store keeps its hash. @throws HttpError 409 beyond `MAX_TOKENS_PER_USER`.
	 */
	async createToken(principal: Principal, name: string): Promise<CreatedApiToken> {
		this.requireServer();
		if ((await this.users.listApiTokens(principal.userId)).length >= MAX_TOKENS_PER_USER) {
			throw new HttpError(409, `Limite de ${MAX_TOKENS_PER_USER} jetons atteinte : révoquez-en un.`);
		}
		const { key, id, hash } = this.apiKeys.generate();
		const record = await this.users.createApiToken(principal.userId, name, {
			id,
			tokenHash: hash,
			expiresAt: Date.now() + API_KEY_TTL_MS,
		});
		return { ...record, token: key };
	}

	/** Only the owner's own tokens: someone else's id is a 404 like an unknown one. */
	async revokeToken(principal: Principal, id: string): Promise<void> {
		this.requireServer();
		if (!(await this.users.deleteApiToken(id, principal.userId))) {
			throw new HttpError(404, "Jeton introuvable");
		}
	}
}
