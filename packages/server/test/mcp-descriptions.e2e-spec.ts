import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { connectMcpClient } from "@nestjs/mcp/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApplication, testConfig } from "@server/test-helpers.js";

// Deliberately a single `testConfig` in this file: tool descriptions are read when the decorators are evaluated
// (`question-tools.ts`, dynamically imported by `QuestionsMcpModule`), hence only once per test file.
// Cases that need another configuration go in their own file.
const config = testConfig({ noOpen: true, baseUrl: "http://exemple:4317", defaultWaitSeconds: 123 });

describe("MCP tool descriptions (e2e)", () => {
	let app: NestFastifyApplication;
	let descriptions: Record<string, string>;
	let schemas: string[];

	beforeAll(async () => {
		app = await createTestApplication({ config });
		await app.init();
		await app.getHttpAdapter().getInstance().ready();
		const client = await connectMcpClient(app);
		const { tools } = await client.listTools();
		descriptions = Object.fromEntries(tools.map((tool) => [tool.name, tool.description ?? ""]));
		schemas = tools.map((tool) => JSON.stringify(tool.inputSchema));
		await client.close();
	});

	afterAll(async () => {
		await app.close();
	});

	it("reflect the default wait timeout from the configuration", () => {
		const withWait = schemas.filter((schema) => schema.includes("wait_seconds"));
		expect(withWait.length).toBe(3);
		for (const schema of withWait) {
			expect(schema).toContain("default 123");
		}
	});

	it("give the relay instruction in ask_user when noOpen is on", () => {
		expect(descriptions.ask_user).toContain("http://exemple:4317");
	});
});
