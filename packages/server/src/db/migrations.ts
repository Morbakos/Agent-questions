import type { DatabaseSync } from "node:sqlite";

interface Migration {
	version: number;
	sql: string;
}

/**
 * Migrations dans l'ordre. Ne jamais modifier une migration déjà publiée : en ajouter une nouvelle.
 * La version appliquée est mémorisée dans `PRAGMA user_version`.
 */
export const migrations: Migration[] = [
	{
		version: 1,
		sql: `
			CREATE TABLE IF NOT EXISTS sessions (
				id             TEXT PRIMARY KEY,
				hash           TEXT NOT NULL,
				title          TEXT NOT NULL,
				questions      TEXT NOT NULL,
				draft          TEXT NOT NULL DEFAULT '{}',
				answers        TEXT,
				status         TEXT NOT NULL DEFAULT 'pending',
				decline_reason TEXT,
				created_at     INTEGER NOT NULL,
				answered_at    INTEGER,
				delivered_at   INTEGER,
				last_seen_at   INTEGER
			);
			CREATE INDEX IF NOT EXISTS idx_sessions_hash ON sessions(hash);
		`,
	},
	{
		version: 2,
		// Édition des questions par l'agent : l'UI compare cette révision pour se rafraîchir.
		sql: "ALTER TABLE sessions ADD COLUMN revision INTEGER NOT NULL DEFAULT 0",
	},
];

const userVersion = (db: DatabaseSync): number =>
	Number((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version);

/**
 * Une base créée avant le versionnement a `user_version = 0` alors que ses tables existent déjà : on déduit sa
 * version réelle de son schéma plutôt que de rejouer des migrations qui échoueraient.
 */
function detectLegacyVersion(db: DatabaseSync): number {
	const columns = db.prepare("PRAGMA table_info(sessions)").all() as { name: string }[];
	if (columns.length === 0) return 0;
	return columns.some((c) => c.name === "revision") ? 2 : 1;
}

/** Applique les migrations manquantes, chacune dans sa transaction. */
export function migrate(db: DatabaseSync): void {
	let current = userVersion(db);
	if (current === 0) {
		current = detectLegacyVersion(db);
		if (current > 0) db.exec(`PRAGMA user_version = ${current}`);
	}
	for (const m of migrations.filter((x) => x.version > current)) {
		db.exec("BEGIN");
		try {
			db.exec(m.sql);
			db.exec(`PRAGMA user_version = ${m.version}`);
			db.exec("COMMIT");
		} catch (err) {
			db.exec("ROLLBACK");
			throw err;
		}
	}
}
