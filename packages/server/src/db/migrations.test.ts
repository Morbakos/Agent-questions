import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { migrate, migrations } from "./migrations.js";

const latest = migrations.at(-1)?.version;
const version = (db: DatabaseSync) =>
	(db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
const columns = (db: DatabaseSync) =>
	(db.prepare("PRAGMA table_info(sessions)").all() as { name: string }[]).map((c) => c.name);

const LEGACY_TABLE = `
	CREATE TABLE sessions (
		id TEXT PRIMARY KEY, hash TEXT NOT NULL, title TEXT NOT NULL, questions TEXT NOT NULL,
		draft TEXT NOT NULL DEFAULT '{}', answers TEXT, status TEXT NOT NULL DEFAULT 'pending',
		decline_reason TEXT, created_at INTEGER NOT NULL, answered_at INTEGER, delivered_at INTEGER,
		last_seen_at INTEGER
	);
	INSERT INTO sessions (id, hash, title, questions, created_at) VALUES ('s1', 'h', 'Ancienne', '[]', 1);
`;

describe("migrate", () => {
	it("a des versions consécutives à partir de 1", () => {
		expect(migrations.map((m) => m.version)).toEqual(migrations.map((_, i) => i + 1));
	});

	it("crée le schéma complet sur une base vide", () => {
		const db = new DatabaseSync(":memory:");
		migrate(db);
		expect(version(db)).toBe(latest);
		expect(columns(db)).toContain("revision");
	});

	it("est idempotent", () => {
		const db = new DatabaseSync(":memory:");
		migrate(db);
		expect(() => migrate(db)).not.toThrow();
		expect(version(db)).toBe(latest);
	});

	it("met à niveau une base d'avant le versionnement, données conservées", () => {
		const db = new DatabaseSync(":memory:");
		db.exec(LEGACY_TABLE);
		migrate(db);
		expect(version(db)).toBe(latest);
		expect(db.prepare("SELECT title, revision FROM sessions WHERE id = 's1'").get()).toMatchObject({
			title: "Ancienne",
			revision: 0,
		});
	});

	it("reconnaît une base d'avant le versionnement qui a déjà la colonne revision", () => {
		const db = new DatabaseSync(":memory:");
		db.exec(LEGACY_TABLE);
		db.exec("ALTER TABLE sessions ADD COLUMN revision INTEGER NOT NULL DEFAULT 0");
		expect(() => migrate(db)).not.toThrow();
		expect(version(db)).toBe(latest);
	});

	it("annule une migration qui échoue sans avancer la version", () => {
		const db = new DatabaseSync(":memory:");
		migrate(db);
		migrations.push({ version: 99, sql: "ALTER TABLE table_inexistante ADD COLUMN x TEXT" });
		try {
			expect(() => migrate(db)).toThrow();
			expect(version(db)).toBe(latest);
		} finally {
			migrations.pop();
		}
	});
});
