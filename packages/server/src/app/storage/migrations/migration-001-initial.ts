import { Migration } from "@mikro-orm/migrations";

/**
 * Initial schema. It is part of the base package: no upgrade path from earlier databases. A schema change
 * is added as a **new** migration (never by editing this one once published).
 *
 * Secrets (login sessions, invitations, API tokens) are stored only hashed (SHA-256); the shape of
 * `auth_sessions` is that of `@nestjs/authentication`'s `SessionStore`. Each question session belongs to a user:
 * every read and write filters on `owner_user_id`.
 */
export class Migration001Initial extends Migration {
	override up(): void {
		this.addSql(`
			CREATE TABLE sessions (
				id             TEXT PRIMARY KEY,
				hash           TEXT NOT NULL,
				title          TEXT NOT NULL,
				questions      TEXT NOT NULL,
				draft          TEXT NOT NULL DEFAULT '{}',
				answers        TEXT,
				status         TEXT NOT NULL DEFAULT 'pending',
				revision       INTEGER NOT NULL DEFAULT 0,
				decline_reason TEXT,
				created_at     INTEGER NOT NULL,
				answered_at    INTEGER,
				delivered_at   INTEGER,
				owner_user_id  TEXT NOT NULL
			)`);
		this.addSql("CREATE INDEX idx_sessions_hash ON sessions(hash)");
		this.addSql("CREATE INDEX idx_sessions_owner ON sessions(owner_user_id, status, created_at)");
		// Supervision (all sessions, most recent first) and history (closed ones, by closing date).
		this.addSql("CREATE INDEX idx_sessions_created ON sessions(created_at)");
		this.addSql(
			"CREATE INDEX idx_sessions_closed ON sessions(owner_user_id, answered_at) WHERE status != 'pending'",
		);

		this.addSql(`
			CREATE TABLE users (
				id            TEXT PRIMARY KEY,
				username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
				password_hash TEXT,
				role          TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
				disabled      INTEGER NOT NULL DEFAULT 0,
				created_at    INTEGER NOT NULL
			)`);
		this.addSql(`
			CREATE TABLE auth_sessions (
				id             TEXT PRIMARY KEY,
				user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
				created_at     INTEGER NOT NULL,
				expires_at     INTEGER NOT NULL,
				last_active_at INTEGER NOT NULL,
				mfa            TEXT,
				metadata       TEXT
			)`);
		this.addSql("CREATE INDEX idx_auth_sessions_user ON auth_sessions(user_id)");
		this.addSql(`
			CREATE TABLE invitations (
				token_hash TEXT PRIMARY KEY,
				user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
				expires_at INTEGER NOT NULL
			)`);
		this.addSql("CREATE INDEX idx_invitations_user ON invitations(user_id)");
		this.addSql(`
			CREATE TABLE api_tokens (
				id         TEXT PRIMARY KEY,
				user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
				name       TEXT NOT NULL,
				token_hash TEXT NOT NULL UNIQUE,
				created_at INTEGER NOT NULL,
				expires_at INTEGER
			)`);
		this.addSql("CREATE INDEX idx_api_tokens_user ON api_tokens(user_id)");
	}
}
