import { MikroORM } from "@mikro-orm/core";
import { Inject, Injectable } from "@nestjs/common";
import { AuthenticationStorage, type MfaState, type SessionRecord, type SessionStore } from "@nestjs/authentication";
import { AuthSessionEntity } from "@app/auth/persistence/entities/auth-session.entity.js";
import { UserEntity } from "@app/auth/persistence/entities/user.entity.js";
import { toUser } from "./user.mapper.js";

const toRecord = ({
	id,
	userId,
	createdAt,
	expiresAt,
	lastActiveAt,
	mfa,
	metadata,
}: AuthSessionEntity): SessionRecord => ({
	id,
	userId,
	createdAt: new Date(createdAt),
	expiresAt: new Date(expiresAt),
	lastActiveAt: new Date(lastActiveAt),
	// Optional fields come back absent (`undefined`), never `null`: that is the `SessionStore` contract.
	...(mfa && { mfa: mfa as MfaState }),
	...(metadata && { metadata }),
});

/**
 * Login sessions (cookie) on the `auth_sessions` table. Implements the `SessionStore` contract of
 * `@nestjs/authentication`, verified by `authenticationStoreContract()` (`mikro-auth-session.store.spec.ts`). Each
 * operation works in a forked `EntityManager`, like the repositories.
 */
@Injectable()
export class MikroAuthSessionStore implements SessionStore {
	constructor(
		@Inject(MikroORM) private readonly orm: MikroORM,
		@Inject(AuthenticationStorage) storage: AuthenticationStorage,
	) {
		storage.registerSource({ sessions: this });
	}

	private get em() {
		return this.orm.em.fork();
	}

	/** With the account, read in the same operation: `SessionAuth` thus does a single read per request. */
	async getSession(id: string): Promise<SessionRecord | undefined> {
		const em = this.em;
		const session = await em.findOne(AuthSessionEntity, { id });
		if (!session) {
			return undefined;
		}
		const user = await em.findOne(UserEntity, { id: session.userId });
		return { ...toRecord(session), ...(user && { extra: { user: toUser(user) } }) };
	}

	async createSession(record: SessionRecord): Promise<void> {
		const em = this.em;
		// Expired sessions are no longer useful: keep the table bounded. The time is that of `SessionService` (the creation
		// date of the new session), never the store's own: that is the contract, and tests control it.
		await em.nativeDelete(AuthSessionEntity, { expiresAt: { $lte: record.createdAt.getTime() } });
		em.create(AuthSessionEntity, {
			id: record.id,
			userId: record.userId,
			createdAt: record.createdAt.getTime(),
			expiresAt: record.expiresAt.getTime(),
			lastActiveAt: record.lastActiveAt.getTime(),
			mfa: record.mfa ?? null,
			metadata: record.metadata ?? null,
		});
		await em.flush();
	}

	/** A single conditional write: a session deleted in the meantime is not resurrected, and activity only moves forward. */
	async touchSession(id: string, lastActiveAt: Date): Promise<void> {
		const at = lastActiveAt.getTime();
		await this.em.nativeUpdate(AuthSessionEntity, { id, lastActiveAt: { $lt: at } }, { lastActiveAt: at });
	}

	async deleteSession(id: string): Promise<boolean> {
		return (await this.em.nativeDelete(AuthSessionEntity, { id })) > 0;
	}

	async listUserSessions(userId: string): Promise<SessionRecord[]> {
		const rows = await this.em.find(AuthSessionEntity, { userId });
		return rows.map(toRecord);
	}

	async deleteUserSessions(userId: string): Promise<void> {
		await this.em.nativeDelete(AuthSessionEntity, { userId });
	}
}
