import { MikroOrmModule } from "@mikro-orm/nestjs";
import { Global, Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { MikroUserRepository } from "@app/auth/persistence/mikro-user.repository.js";
import { UserRepository } from "@app/auth/persistence/user.repository.js";
import { appConfigOf } from "@app/config/app.config.js";
import type { AppConfig } from "@app/config/config.js";
import { loadConfig } from "@app/config/config.js";
import { UiHub } from "@app/events/ui-hub.js";
import { MikroSessionRepository } from "@app/sessions/persistence/mikro-session.repository.js";
import { SessionRepository } from "@app/sessions/persistence/session.repository.js";
import { ormOptions } from "@app/storage/orm.js";
import { StorageBootstrap } from "@app/storage/storage-bootstrap.js";

/** Both optional: `config` defaults to `loadConfig()` (environment), `hub` to a fresh `UiHub` (tests share one to observe it). */
export interface CoreOptions {
	config?: AppConfig;
	hub?: UiHub;
}

/**
 * Global foundation: configuration, SQLite database (`MikroOrmModule`, migrated at initialization then closed by the
 * Nest lifecycle), repositories and SSE hub. Services depend on the abstract classes `SessionRepository` /
 * `UserRepository`, not on MikroORM: to change storage, only the `useClass` entries below change. Tests choose the
 * database through `config.dbFile` (`:memory:`).
 */
@Global()
@Module({})
export class CoreModule {
	static register({ config = loadConfig(), hub = new UiHub() }: CoreOptions = {}) {
		return {
			module: CoreModule,
			global: true,
			imports: [
				// No `.env` file read, no `@nestjs/config` validation: `loadConfig` already validates `process.env`.
				ConfigModule.forRoot({ ignoreEnvFile: true, isGlobal: true, load: [appConfigOf(config)] }),
				MikroOrmModule.forRoot(ormOptions(config.dbFile)),
			],
			providers: [
				StorageBootstrap,
				{ provide: SessionRepository, useClass: MikroSessionRepository },
				{ provide: UserRepository, useClass: MikroUserRepository },
				{ provide: UiHub, useValue: hub },
			],
			exports: [SessionRepository, UserRepository, UiHub],
		};
	}
}
