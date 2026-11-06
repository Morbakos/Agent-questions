import { type DynamicModule, Module } from "@nestjs/common";
import { Authenticate } from "@nestjs/authentication";
import { McpModule } from "@nestjs/mcp";
import { ApiKeyAuth } from "@app/auth/providers/api-key-auth.js";
import { LocalAuth } from "@app/auth/providers/local-auth.js";
import type { AppConfig } from "@app/config/config.js";
import { setRuntimeConfig } from "@app/config/runtime-config.js";
import { relayHintOf } from "@app/mcp/relay-hint.js";
import { SessionsModule } from "@app/sessions/sessions.module.js";
import { APP_VERSION } from "@app/version.js";

/**
 * MCP server (`/mcp`), provided by `@nestjs/mcp`: the tools are the methods of `QuestionTools`. The route is a Nest
 * controller like any other, so the global `AuthGuard` authenticates it before the tool call and the Host/Origin checks
 * of `http-setup.ts` apply to it; the module's own (`allowedOrigins`) are therefore disabled so as not to refuse the
 * origins declared by `AQ_ALLOWED_ORIGINS`.
 *
 * The module is **asynchronous** (Nest accepts a `Promise<DynamicModule>`): tool descriptions depend on the
 * configuration and a decorator is evaluated at import. `question-tools.ts` is therefore imported only here,
 * dynamically, after `setRuntimeConfig`.
 */
@Module({})
export class QuestionsMcpModule {
	/**
	 * Must be awaited before the Nest application is created: it publishes `config` (`setRuntimeConfig`) and only then
	 * imports `QuestionTools`, so tool descriptions are frozen per process from this config.
	 */
	static async register(config: AppConfig): Promise<DynamicModule> {
		const relayHint = relayHintOf(config);
		setRuntimeConfig(config);
		const { QuestionTools } = await import("./api/question-tools.js");
		return {
			module: QuestionsMcpModule,
			imports: [
				SessionsModule,
				McpModule.forRoot({
					name: "agent-questions",
					version: APP_VERSION,
					...(relayHint && { instructions: relayHint }),
					include: [QuestionsMcpModule],
					http: { allowedOrigins: false },
					// `/mcp` accepts only API tokens (and the local user): the session cookie is reserved for the UI.
					decorators: [Authenticate({ providers: [ApiKeyAuth, LocalAuth] })],
				}),
			],
			providers: [QuestionTools],
		};
	}
}
