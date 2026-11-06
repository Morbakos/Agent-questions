import type { Role } from "@agent-questions/shared";
import type { ApiTokenRecord, StoredApiKey, UserRecord } from "@app/auth/domain/user.js";

/**
 * Persistence of accounts, invitations and API tokens. Secrets (invitation, token) are received only
 * **hashed**: this repository never sees a clear secret. Login sessions live in `MikroAuthSessionStore`
 * (`SessionStore` contract of `@nestjs/authentication`).
 */
export abstract class UserRepository {
	/** Number of accounts of any kind; zero triggers the first-admin bootstrap in server mode. */
	abstract count(): Promise<number>;
	/** Admins that are not disabled: used to keep at least one. */
	abstract enabledAdminCount(): Promise<number>;
	abstract get(id: string): Promise<UserRecord | undefined>;
	/** Case-insensitive lookup. */
	abstract findByUsername(username: string): Promise<UserRecord | undefined>;
	abstract list(): Promise<UserRecord[]>;
	/** Throws an `HttpError` 409 if the username is already taken (case-insensitive). */
	abstract create(input: { username: string; role: Role; passwordHash: string | null }): Promise<UserRecord>;
	abstract update(id: string, patch: { role?: Role; disabled?: boolean; passwordHash?: string }): Promise<void>;

	/** A single valid invitation per account: creating a new one cancels the previous one. */
	abstract replaceInvitation(userId: string, tokenHash: string, expiresAt: number): Promise<void>;
	/** The account for a hashed invitation token, or `undefined` if unknown or expired. */
	abstract findInvitation(tokenHash: string): Promise<UserRecord | undefined>;
	abstract deleteInvitationsOf(userId: string): Promise<void>;
	/** Deletes every API token of the account (used when an admin disables it with token revocation). */
	abstract deleteApiTokensOf(userId: string): Promise<void>;

	/** `id` and `tokenHash` come from `ApiKeyProvider.generate()`; `expiresAt`: milliseconds since the epoch. */
	abstract createApiToken(
		userId: string,
		name: string,
		key: { id: string; tokenHash: string; expiresAt: number },
	): Promise<ApiTokenRecord>;
	abstract listApiTokens(userId: string): Promise<ApiTokenRecord[]>;
	/** Scoped to `userId`; `false` when nothing was deleted (unknown, or owned by someone else). */
	abstract deleteApiToken(id: string, userId: string): Promise<boolean>;
	/** The API token with public id `id`, with its owner. */
	abstract findApiKey(id: string): Promise<StoredApiKey | undefined>;
}
