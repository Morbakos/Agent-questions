import { MikroORM } from "@mikro-orm/core";
import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import { prepareDatabase } from "./orm.js";

/**
 * Applies PRAGMAs and migrations as soon as the module initializes. Services that read the database at startup
 * (creation of the first administrator) do so in `onApplicationBootstrap`, which runs **after** all `onModuleInit`:
 * the schema then exists. Closing the database is handled by `MikroOrmModule` (`enableShutdownHooks`), after
 * `SessionsService.beforeApplicationShutdown` wakes the waits.
 */
@Injectable()
export class StorageBootstrap implements OnModuleInit {
	constructor(@Inject(MikroORM) private readonly orm: MikroORM) {}

	async onModuleInit(): Promise<void> {
		await prepareDatabase(this.orm);
	}
}
