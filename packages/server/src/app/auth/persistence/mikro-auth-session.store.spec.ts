import type { MikroORM } from "@mikro-orm/core";
import { type AuthenticationStorage, type SessionRecord } from "@nestjs/authentication";
import { authenticationStoreContract } from "@nestjs/authentication/testing";
import { afterEach, describe, expect, it } from "vitest";
import { UserEntity } from "@app/auth/persistence/entities/user.entity.js";
import { memoryOrm } from "@server/test-helpers.js";
import { MikroAuthSessionStore } from "./mikro-auth-session.store.js";

const noStorage = { registerSource: () => undefined } as unknown as AuthenticationStorage;
const opened: MikroORM[] = [];

/**
 * The contract invents user identifiers: `auth_sessions.user_id` references `users`, so the account is created
 * on the fly (the real schema keeps its foreign key).
 */
class StoreForContract extends MikroAuthSessionStore {
	constructor(private readonly db: MikroORM) {
		super(db, noStorage);
	}

	override async createSession(record: SessionRecord): Promise<void> {
		const em = this.db.em.fork();
		if (!(await em.findOne(UserEntity, { id: record.userId }))) {
			em.create(UserEntity, {
				id: record.userId,
				username: record.userId,
				role: "member",
				disabled: false,
				createdAt: 1,
			});
			await em.flush();
		}
		await super.createSession(record);
	}
}

afterEach(async () => {
	await Promise.all(opened.splice(0).map((orm) => orm.close()));
});

describe("MikroAuthSessionStore: SessionStore contract of @nestjs/authentication", () => {
	const cases = authenticationStoreContract(
		async () => {
			const orm = await memoryOrm();
			opened.push(orm);
			return { sessions: new StoreForContract(orm) };
		},
		{ contracts: ["sessions"] },
	);
	it("provides cases", () => {
		expect(cases.length).toBeGreaterThan(0);
	});
	for (const { name, run } of cases) {
		it(name, run);
	}
});
