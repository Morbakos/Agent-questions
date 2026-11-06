import { registerAs } from "@nestjs/config";
import { type AppConfig, loadConfig } from "@app/config/config.js";

/**
 * `@nestjs/config` namespace carrying the validated configuration. Providers inject it with
 * `@Inject(appConfig.KEY)` (type `ConfigType<typeof appConfig>`, i.e. `AppConfig`).
 */
export const appConfig = registerAs("app", () => loadConfig());

/** Same namespace (hence same token) with an already built configuration: the application entry point and tests. */
export const appConfigOf = (config: AppConfig) => registerAs("app", () => config);
