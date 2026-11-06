import { randomUUID } from "node:crypto";
import { MikroORM, UniqueConstraintViolationException } from "@mikro-orm/core";
import { Inject, Injectable } from "@nestjs/common";
import type { Role } from "@agent-questions/shared";
import type { ApiTokenRecord, StoredApiKey, UserRecord } from "@app/auth/domain/user.js";
import { ApiTokenEntity } from "@app/auth/persistence/entities/api-token.entity.js";
import { InvitationEntity } from "@app/auth/persistence/entities/invitation.entity.js";
import { UserEntity } from "@app/auth/persistence/entities/user.entity.js";
import { HttpError } from "@app/http/http-error.js";
import { toUser } from "./user.mapper.js";
import { UserRepository } from "./user.repository.js";

/** MikroORM implementation (one forked `EntityManager` per operation). */
@Injectable()
export class MikroUserRepository extends UserRepository {
	constructor(@Inject(MikroORM) private readonly orm: MikroORM) {
		super();
	}

	private get em() {
		return this.orm.em.fork();
	}

	// --- Accounts

	count(): Promise<number> {
		return this.em.count(UserEntity);
	}

	enabledAdminCount(): Promise<number> {
		return this.em.count(UserEntity, { role: "admin", disabled: false });
	}

	async get(id: string): Promise<UserRecord | undefined> {
		const entity = await this.em.findOne(UserEntity, { id });
		return entity ? toUser(entity) : undefined;
	}

	// `username` is `COLLATE NOCASE` in the schema: the comparison ignores case.
	async findByUsername(username: string): Promise<UserRecord | undefined> {
		const entity = await this.em.findOne(UserEntity, { username });
		return entity ? toUser(entity) : undefined;
	}

	async list(): Promise<UserRecord[]> {
		const rows = await this.em.find(UserEntity, {}, { orderBy: { createdAt: "asc", username: "asc" } });
		return rows.map(toUser);
	}

	async create({
		username,
		role,
		passwordHash,
	}: {
		username: string;
		role: Role;
		passwordHash: string | null;
	}): Promise<UserRecord> {
		const em = this.em;
		const entity = em.create(UserEntity, {
			id: randomUUID(),
			username,
			passwordHash,
			role,
			disabled: false,
			createdAt: Date.now(),
		});
		try {
			await em.flush();
		} catch (error) {
			if (error instanceof UniqueConstraintViolationException || /UNIQUE/i.test((error as Error).message)) {
				throw new HttpError(409, "Cet identifiant est déjà utilisé");
			}
			throw error;
		}
		return toUser(entity);
	}

	async update(
		id: string,
		{ role, disabled, passwordHash }: { role?: Role; disabled?: boolean; passwordHash?: string },
	): Promise<void> {
		const data: Partial<Pick<UserEntity, "role" | "disabled" | "passwordHash">> = {};
		if (role !== undefined) {
			data.role = role;
		}
		if (disabled !== undefined) {
			data.disabled = disabled;
		}
		if (passwordHash !== undefined) {
			data.passwordHash = passwordHash;
		}
		if (Object.keys(data).length > 0) {
			await this.em.nativeUpdate(UserEntity, { id }, data);
		}
	}

	// --- Invitations

	/** A single valid invitation per account: creating a new one cancels the previous one. */
	async replaceInvitation(userId: string, tokenHash: string, expiresAt: number): Promise<void> {
		await this.em.transactional(async (em) => {
			// Expired invitations are no longer useful: keep the table bounded.
			await em.nativeDelete(InvitationEntity, { $or: [{ userId }, { expiresAt: { $lte: Date.now() } }] });
			em.create(InvitationEntity, { tokenHash, userId, expiresAt });
		});
	}

	async findInvitation(tokenHash: string): Promise<UserRecord | undefined> {
		const em = this.em;
		const invitation = await em.findOne(InvitationEntity, { tokenHash, expiresAt: { $gt: Date.now() } });
		const user = invitation && (await em.findOne(UserEntity, { id: invitation.userId }));
		return user ? toUser(user) : undefined;
	}

	async deleteInvitationsOf(userId: string): Promise<void> {
		await this.em.nativeDelete(InvitationEntity, { userId });
	}

	// --- Personal tokens (MCP clients)

	async createApiToken(
		userId: string,
		name: string,
		{ id, tokenHash, expiresAt }: { id: string; tokenHash: string; expiresAt: number },
	): Promise<ApiTokenRecord> {
		const em = this.em;
		const entity = em.create(ApiTokenEntity, { id, userId, name, tokenHash, createdAt: Date.now(), expiresAt });
		await em.flush();
		return { id: entity.id, name: entity.name, createdAt: entity.createdAt };
	}

	async listApiTokens(userId: string): Promise<ApiTokenRecord[]> {
		const rows = await this.em.find(ApiTokenEntity, { userId }, { orderBy: { createdAt: "desc" } });
		return rows.map(({ id, name, createdAt }) => ({ id, name, createdAt }));
	}

	async deleteApiTokensOf(userId: string): Promise<void> {
		await this.em.nativeDelete(ApiTokenEntity, { userId });
	}

	async deleteApiToken(id: string, userId: string): Promise<boolean> {
		return (await this.em.nativeDelete(ApiTokenEntity, { id, userId })) > 0;
	}

	async findApiKey(id: string): Promise<StoredApiKey | undefined> {
		const em = this.em;
		const token = await em.findOne(ApiTokenEntity, { id });
		const user = token && (await em.findOne(UserEntity, { id: token.userId }));
		return token && user
			? { tokenHash: token.tokenHash, user: toUser(user), expiresAt: token.expiresAt }
			: undefined;
	}
}
