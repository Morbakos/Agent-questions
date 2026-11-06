import type { MikroORM } from "@mikro-orm/core";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { PasswordHasher } from "@nestjs/authentication";
import { Test } from "@nestjs/testing";
import type { Question } from "@agent-questions/shared";
import { AppModule } from "@app/app.module.js";
import { createFastifyAdapter, setupApplication } from "@app/application.js";
import type { AppConfig } from "@app/config/config.js";
import type { CoreOptions } from "@app/core/core.module.js";
import { createOrm } from "@app/storage/orm.js";

/** In-memory, migrated SQLite database for a repository or service test outside the full application. */
export const memoryOrm = (): Promise<MikroORM> => createOrm(":memory:");

/**
 * Full Nest application for an e2e test, built the way the Nest documentation does it
 * (`Test.createTestingModule` then `createNestApplication`) with the same settings as `main.ts` (`setupApplication`).
 * It is not initialized: the caller does `await app.init()` (or `listen`), then `await app.close()`. The database is
 * the one from `config.dbFile` (`:memory:` by default).
 */
export async function createTestApplication(
	options: CoreOptions & { config: AppConfig },
): Promise<NestFastifyApplication> {
	// scrypt is slow by design (128 MiB by default): tests use a reduced cost.
	const moduleRef = await Test.createTestingModule({ imports: [AppModule.register(options)] })
		.overrideProvider(PasswordHasher)
		.useValue(new PasswordHasher({ logN: 10 }))
		.compile();
	const app = moduleRef.createNestApplication<NestFastifyApplication>(createFastifyAdapter(options.config));
	await setupApplication(app, options.config);
	return app;
}

/** Test configuration: never opens the browser, in-memory database. */
export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
	return {
		deploymentMode: "local",
		host: "127.0.0.1",
		port: 4317,
		baseUrl: "http://127.0.0.1:4317",
		allowedHosts: [],
		allowedOrigins: [],
		dbFile: ":memory:",
		uiDir: "/inexistant",
		defaultWaitSeconds: 1,
		noOpen: true,
		dev: false,
		trustProxy: 0,
		logLevel: "silent",
		admin: null,
		...overrides,
	};
}

/** A valid `single` question (id `choix`, options `a` recommended and `b`); `overrides` replaces any field. */
export const singleQuestion = (overrides: Partial<Question> = {}): Question => ({
	id: "choix",
	prompt: "Lequel ?",
	type: "single",
	options: [
		{ id: "a", label: "A", recommended: true },
		{ id: "b", label: "B" },
	],
	...overrides,
});

/** A valid `text` question (id `libre`); `overrides` replaces any field. */
export const textQuestion = (overrides: Partial<Question> = {}): Question => ({
	id: "libre",
	prompt: "Pourquoi ?",
	type: "text",
	...overrides,
});
