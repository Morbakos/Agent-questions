import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { MikroORM } from "@mikro-orm/core";
import { ReflectMetadataProvider } from "@mikro-orm/decorators/legacy";
import { Migrator } from "@mikro-orm/migrations";
import { NodeSqliteDialect, SqliteDriver } from "@mikro-orm/sql";
import { ApiTokenEntity } from "@app/auth/persistence/entities/api-token.entity.js";
import { AuthSessionEntity } from "@app/auth/persistence/entities/auth-session.entity.js";
import { InvitationEntity } from "@app/auth/persistence/entities/invitation.entity.js";
import { UserEntity } from "@app/auth/persistence/entities/user.entity.js";
import { SessionEntity } from "@app/sessions/persistence/session.entity.js";
import { Migration001Initial } from "./migrations/migration-001-initial.js";

/** All entities, listed explicitly: the Bun bundle has no file discovery. */
export const entities = [SessionEntity, UserEntity, AuthSessionEntity, InvitationEntity, ApiTokenEntity];

/** The `name` is explicit: a minifier could rename classes and change the name registered in the database. */
const migrationsList = [{ name: "Migration001Initial", class: Migration001Initial }];

/**
 * SQLite settings applied once at open. The WAL never shrinks on its own: by default it reaches ~4 MB
 * (1000 pages) then keeps that size, for a few KB of data. We checkpoint it every ~400 KB (100 pages), truncate it
 * after each checkpoint, and flush any WAL left by an abrupt shutdown.
 */
const PRAGMAS = [
	"PRAGMA journal_mode = WAL",
	"PRAGMA foreign_keys = ON",
	"PRAGMA busy_timeout = 5000",
	"PRAGMA wal_autocheckpoint = 100",
	"PRAGMA journal_size_limit = 262144",
];

/**
 * Flushes the WAL that an abrupt shutdown may have left. On a throwaway connection **before** MikroORM:
 * `wal_checkpoint(TRUNCATE)` fails ("database table is locked") on Kysely's connection, which keeps a query active.
 */
function flushWal(file: string): void {
	const connection = new DatabaseSync(file);
	try {
		connection.exec("PRAGMA journal_mode = WAL");
		connection.exec("PRAGMA wal_checkpoint(TRUNCATE)");
	} finally {
		connection.close();
	}
}

/**
 * MikroORM options (SQLite via `node:sqlite`, no native module: Node ≥ 22.13 and Bun ≥ 1.4), passed to
 * `MikroOrmModule.forRoot` (`CoreModule`). Prepares the folder and flushes any WAL left by an abrupt shutdown
 * before opening. The dialect uses only **one** connection (`:memory:` stays consistent).
 */
export function ormOptions(file: string) {
	if (file !== ":memory:") {
		mkdirSync(dirname(file), { recursive: true });
		flushWal(file);
	}
	return {
		driver: SqliteDriver,
		dbName: file,
		driverOptions: new NodeSqliteDialect(file),
		// Types declared explicitly in the decorators (Bun does not emit `emitDecoratorMetadata`).
		metadataProvider: ReflectMetadataProvider,
		entities,
		extensions: [Migrator],
		// The migrator stays silent: the startup log is Nest's.
		migrations: { migrationsList, snapshot: false, silent: true },
		// Each repository works in a forked `EntityManager`: no need for the request context (middleware).
		registerRequestContext: false,
	};
}

/** Sets the SQLite PRAGMAs then applies the migrations. Called once, when the storage module initializes. */
export async function prepareDatabase(orm: MikroORM): Promise<void> {
	const connection = orm.em.getConnection();
	for (const pragma of PRAGMAS) {
		await connection.execute(pragma);
	}
	await orm.migrator.up();
}

/** Opens and prepares a database outside Nest (repository tests, `:memory:` or file). */
export async function createOrm(file: string): Promise<MikroORM> {
	const orm = await MikroORM.init(ormOptions(file));
	await prepareDatabase(orm);
	return orm;
}
