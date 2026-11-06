import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MikroORM } from "@mikro-orm/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createOrm } from "./orm.js";

describe("file-based SQLite storage", () => {
	it("opens, closes and reopens (WAL, migrations already applied)", async () => {
		const dir = mkdtempSync(join(tmpdir(), "aq-orm-"));
		const file = join(dir, "sub", "base.sqlite");
		try {
			const first = await createOrm(file);
			await first.em
				.getConnection()
				.execute(
					"INSERT INTO users (id, username, role, disabled, created_at) VALUES ('u', 'a', 'member', 0, 1)",
				);
			const [journal] = await first.em.getConnection().execute<{ journal_mode: string }[]>("PRAGMA journal_mode");
			expect(journal?.journal_mode).toBe("wal");
			await first.close();

			const second = await createOrm(file);
			const users = await second.em.getConnection().execute<{ id: string }[]>("SELECT id FROM users");
			expect(users).toEqual([{ id: "u" }]);
			const applied = await second.em
				.getConnection()
				.execute<{ name: string }[]>("SELECT name FROM mikro_orm_migrations");
			expect(applied).toHaveLength(1);
			await second.close();
			expect(existsSync(file)).toBe(true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("SQLite storage (MikroORM)", () => {
	let orm: MikroORM;

	beforeEach(async () => {
		orm = await createOrm(":memory:");
	});

	afterEach(async () => {
		await orm.close();
	});

	const rows = <T>(sql: string): Promise<T[]> => orm.em.getConnection().execute<T[]>(sql);

	it("creates the tables and indexes of the initial schema", async () => {
		const tables = (await rows<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")).map(
			(row) => row.name,
		);
		expect(tables).toEqual(
			expect.arrayContaining(["sessions", "users", "auth_sessions", "invitations", "api_tokens"]),
		);
		const indexes = (await rows<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'index'")).map(
			(row) => row.name,
		);
		expect(indexes).toEqual(
			expect.arrayContaining([
				"idx_sessions_hash",
				"idx_sessions_owner",
				"idx_sessions_created",
				"idx_sessions_closed",
				"idx_auth_sessions_user",
				"idx_invitations_user",
				"idx_api_tokens_user",
			]),
		);
	});

	it("applies each migration only once", async () => {
		await orm.migrator.up();
		const applied = await rows<{ name: string }>("SELECT name FROM mikro_orm_migrations");
		expect(applied.map((row) => row.name)).toEqual(["Migration001Initial"]);
	});

	it("enables foreign keys", async () => {
		const [pragma] = await rows<{ foreign_keys: number }>("PRAGMA foreign_keys");
		expect(pragma?.foreign_keys).toBe(1);
	});

	it("rejects two identifiers that differ only by case", async () => {
		const connection = orm.em.getConnection();
		const insert = "INSERT INTO users (id, username, role, disabled, created_at) VALUES (?, ?, 'member', 0, 1)";
		await connection.execute(insert, ["u1", "Alice"]);
		await expect(connection.execute(insert, ["u2", "alice"])).rejects.toThrow(/UNIQUE/i);
	});

	it("deletes sign-in sessions, invitations and tokens along with the account", async () => {
		const connection = orm.em.getConnection();
		await connection.execute(
			"INSERT INTO users (id, username, role, disabled, created_at) VALUES ('u', 'bob', 'member', 0, 1)",
		);
		await connection.execute(
			"INSERT INTO auth_sessions (id, user_id, created_at, expires_at, last_active_at) VALUES ('h', 'u', 1, 9, 1)",
		);
		await connection.execute("INSERT INTO invitations (token_hash, user_id, expires_at) VALUES ('i', 'u', 9)");
		await connection.execute(
			"INSERT INTO api_tokens (id, user_id, name, token_hash, created_at) VALUES ('t', 'u', 'n', 'x', 1)",
		);
		await connection.execute("DELETE FROM users WHERE id = 'u'");
		for (const table of ["auth_sessions", "invitations", "api_tokens"]) {
			expect(await rows(`SELECT 1 FROM ${table}`), table).toHaveLength(0);
		}
	});
});
