import { Test } from "@nestjs/testing";
import { describe, expect, it } from "vitest";
import { ConfigModule } from "@nestjs/config";
import { appConfig, appConfigOf } from "@app/config/app.config.js";
import { loadConfig } from "@app/config/config.js";

describe("appConfig", () => {
	it("injects the validated configuration, admin sub-object included, through appConfig.KEY", async () => {
		const config = loadConfig({
			AQ_DEPLOYMENT_MODE: "server",
			AQ_PUBLIC_URL: "https://aq.example.com",
			AQ_DATA_DIR: "/data",
			AQ_ADMIN_USERNAME: "boss",
			AQ_ADMIN_PASSWORD: "a-long-enough-password",
		});
		const moduleRef = await Test.createTestingModule({
			imports: [ConfigModule.forRoot({ ignoreEnvFile: true, isGlobal: true, load: [appConfigOf(config)] })],
		}).compile();
		const injected = moduleRef.get<ReturnType<typeof appConfig>>(appConfig.KEY);
		expect(injected).toEqual(config);
		expect(injected.admin).toEqual({ username: "boss", password: "a-long-enough-password" });
	});
});
