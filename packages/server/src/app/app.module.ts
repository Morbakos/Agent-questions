import { existsSync } from "node:fs";
import { Module } from "@nestjs/common";
import type { DynamicModule } from "@nestjs/common";
import { ServeStaticModule } from "@nestjs/serve-static";
import { TerminusModule } from "@nestjs/terminus";
import { AuthModule } from "@app/auth/auth.module.js";
import { type CoreOptions, CoreModule } from "@app/core/core.module.js";
import { EventsModule } from "@app/events/events.module.js";
import { HealthController } from "@app/health/api/health.controller.js";
import { UnknownRouteController } from "@app/http/unknown-route.controller.js";
import { loadConfig } from "@app/config/config.js";
import { QuestionsMcpModule } from "@app/mcp/mcp.module.js";
import { SessionsModule } from "@app/sessions/sessions.module.js";

@Module({
	imports: [SessionsModule, EventsModule, TerminusModule],
	controllers: [HealthController, UnknownRouteController],
})
export class AppModule {
	static register(options: CoreOptions = {}): DynamicModule {
		const { config = loadConfig() } = options;
		return {
			module: AppModule,
			imports: [
				CoreModule.register({ ...options, config }),
				AuthModule.register(config),
				QuestionsMcpModule.register(config),
				// The Angular UI: static files, plus `index.html` for its routes (`fallthrough`, otherwise 404: see the docs). The
				// API prefixes are covered by `UnknownRouteController`. Without a built UI, nothing is served.
				...(existsSync(config.uiDir)
					? [ServeStaticModule.forRoot({ rootPath: config.uiDir, serveStaticOptions: { fallthrough: true } })]
					: []),
			],
		};
	}
}
