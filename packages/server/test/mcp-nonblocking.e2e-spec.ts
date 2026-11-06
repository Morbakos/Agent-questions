import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type { Client } from "@modelcontextprotocol/client";
import { connectMcpClient } from "@nestjs/mcp/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApplication, testConfig } from "@server/test-helpers.js";

// A single `testConfig` in this file: descriptions are frozen per process and per file (see
// `mcp-descriptions.e2e-spec.ts`). Here, the product's default configuration: the call does not block.
const config = testConfig({ defaultWaitSeconds: 0 });
const questions = [{ id: "q", prompt: "ok ?", type: "text" }];

describe("wait chosen by the agent (e2e, AQ_WAIT_SECONDS = 0)", () => {
	let app: NestFastifyApplication;
	let client: Client;

	beforeAll(async () => {
		app = await createTestApplication({ config });
		await app.init();
		await app.getHttpAdapter().getInstance().ready();
		client = await connectMcpClient(app);
	});

	afterAll(async () => {
		await client.close();
		await app.close();
	});

	const call = async (name: string, args: Record<string, unknown>) => {
		const startedAt = Date.now();
		const result = (await client.callTool({ name, arguments: args })) as { content: { text: string }[] };
		return {
			json: JSON.parse(result.content[0]?.text ?? "{}") as Record<string, unknown>,
			ms: Date.now() - startedAt,
		};
	};

	it("ask_user without wait_seconds returns pending immediately, with the address and the instruction to call get_answers again", async () => {
		const { json, ms } = await call("ask_user", { title: "Sans attente", questions });
		expect(json).toMatchObject({ status: "pending", url: expect.stringContaining("/s/") });
		expect(String(json["message"])).toContain("get_answers");
		expect(ms).toBeLessThan(500);
	});

	it("get_answers without wait_seconds only reads the state", async () => {
		const { json } = await call("ask_user", { title: "Lecture", questions: [{ ...questions[0], id: "r" }] });
		const { json: state, ms } = await call("get_answers", { session_id: json["session_id"] });
		expect(state).toMatchObject({ status: "pending", session_id: json["session_id"] });
		expect(ms).toBeLessThan(500);
	});

	it("a positive wait_seconds makes the agent wait, so it chooses to block", async () => {
		const { json, ms } = await call("ask_user", {
			title: "Avec attente",
			questions: [{ ...questions[0], id: "w" }],
			wait_seconds: 1,
		});
		expect(json).toMatchObject({ status: "pending" });
		expect(ms).toBeGreaterThanOrEqual(900);
	});

	it("the ask_user description states there is no waiting by default", async () => {
		const { tools } = await client.listTools();
		const askUser = tools.find(({ name }) => name === "ask_user");
		expect(askUser?.description).toContain("By default the call does not wait");
		expect(JSON.stringify(askUser?.inputSchema)).toContain("default 0, which returns immediately");
	});
});
