import type { Client } from "@modelcontextprotocol/client";
import { connectMcpClient } from "@nestjs/mcp/testing";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "@app/config/config.js";
import { LOCAL_USER_ID } from "@app/auth/domain/principal.js";
import { openInBrowser } from "@app/mcp/open.js";
import { SessionsService } from "@app/sessions/sessions.service.js";
import { createTestApplication, singleQuestion, testConfig, textQuestion } from "@server/test-helpers.js";
import { UiHub } from "@app/events/ui-hub.js";

vi.mock("@app/mcp/open.js", () => ({ openInBrowser: vi.fn() }));

let app: NestFastifyApplication;
let store: SessionsService;
let hub: UiHub;
let client: Client;

/** Starts the full application (Nest, `@nestjs/mcp`) with this configuration and connects an in-memory client to it. */
async function connect(config: AppConfig = testConfig()): Promise<void> {
	hub = new UiHub();
	app = await createTestApplication({ config, hub });
	await app.init();
	await app.getHttpAdapter().getInstance().ready();
	store = app.get(SessionsService);
	client = await connectMcpClient(app);
}

async function call(name: string, args: Record<string, unknown>) {
	const result = await client.callTool({ name, arguments: args });
	const text = (result.content as { type: string; text: string }[])[0]?.text ?? "";
	return { isError: result.isError === true, text, json: result.isError ? undefined : JSON.parse(text) };
}

async function restart(config: AppConfig): Promise<void> {
	await client.close();
	await app.close();
	await connect(config);
}

beforeEach(async () => {
	vi.mocked(openInBrowser).mockClear();
	await connect();
});

afterEach(async () => {
	await client.close();
	await app.close();
});

const questions = [singleQuestion(), textQuestion()];

describe("MCP protocol negotiation and tools/list", () => {
	it("exposes the three tools on the modern MCP revision", async () => {
		expect(client.getProtocolEra()).toBe("modern");
		const { tools } = await client.listTools();
		expect(tools.map((tool) => tool.name).sort()).toEqual(["ask_user", "get_answers", "update_questions"]);
	});

	it("asks the agent to give the UI address when noOpen is on", async () => {
		await restart(testConfig({ noOpen: true, baseUrl: "http://exemple:4317" }));
		expect(client.getInstructions()).toContain("http://exemple:4317");
	});
});

describe("browser opening", () => {
	const other = [textQuestion({ id: "autre" })];

	beforeEach(async () => {
		await restart(testConfig({ noOpen: false }));
	});

	it("opens a tab on the session when no UI is open", async () => {
		const { json } = await call("ask_user", { title: "T", questions, wait_seconds: 0 });
		expect(openInBrowser).toHaveBeenCalledExactlyOnceWith(`http://127.0.0.1:4317/s/${json.session_id}`);
	});

	it("never opens a second tab: the next session arrives in the already open tab", async () => {
		await call("ask_user", { title: "T", questions, wait_seconds: 0 });
		await call("ask_user", { title: "T2", questions: other, wait_seconds: 0 });
		expect(openInBrowser).toHaveBeenCalledTimes(1);
	});

	it("opens nothing when a UI is already connected", async () => {
		vi.spyOn(hub, "hasUi").mockReturnValue(true);
		await call("ask_user", { title: "T", questions, wait_seconds: 0 });
		expect(openInBrowser).not.toHaveBeenCalled();
	});

	it("opens nothing with noOpen", async () => {
		await restart(testConfig({ noOpen: true }));
		await call("ask_user", { title: "T", questions, wait_seconds: 0 });
		expect(openInBrowser).not.toHaveBeenCalled();
	});
});

describe("ask_user", () => {
	it("returns pending with the session address when nobody answers", async () => {
		const { json } = await call("ask_user", { title: "T", questions, wait_seconds: 0 });
		expect(json.status).toBe("pending");
		expect(json.url).toBe(`http://127.0.0.1:4317/s/${json.session_id}`);
	});

	it("stays idempotent: same questions, same session", async () => {
		const first = await call("ask_user", { title: "T", questions, wait_seconds: 0 });
		const second = await call("ask_user", { title: "T", questions, wait_seconds: 0 });
		expect(second.json.session_id).toBe(first.json.session_id);
	});

	it("announces the new session to open tabs, only once", async () => {
		const announce = vi.spyOn(hub, "announce");
		const first = await call("ask_user", { title: "T", questions, wait_seconds: 0 });
		expect(announce).toHaveBeenCalledExactlyOnceWith(
			LOCAL_USER_ID,
			expect.objectContaining({ id: first.json.session_id, title: "T" }),
		);
		await call("ask_user", { title: "T", questions, wait_seconds: 0 });
		await call("get_answers", { session_id: first.json.session_id, wait_seconds: 0 });
		expect(announce).toHaveBeenCalledTimes(1);
	});

	it("describes background execution in the tool description", async () => {
		const { tools } = await client.listTools();
		expect(tools.find((tool) => tool.name === "ask_user")?.description).toContain("background task");
	});

	it("tells the agent not to use it to get a plan approved", async () => {
		const { tools } = await client.listTools();
		expect(tools.find((tool) => tool.name === "ask_user")?.description).toContain(
			"NOT for asking the user to approve",
		);
	});

	it("completes as soon as the user answers and delivers the labels", async () => {
		const pending = call("ask_user", { title: "T", questions, wait_seconds: 5 });
		await waitForSession();
		const session = (await store.listOpen(LOCAL_USER_ID))[0]!;
		await store.submit(LOCAL_USER_ID, session.id, {
			choix: { selected: ["b"], text: "" },
			libre: { selected: [], text: "parce que" },
		});
		const { json } = await pending;
		expect(json.status).toBe("answered");
		expect(json.answers).toEqual([
			{ question_id: "choix", selected: [{ id: "b", label: "B" }] },
			{ question_id: "libre", selected: [], text: "parce que" },
		]);
		expect((await store.get(LOCAL_USER_ID, session.id))?.deliveredAt).not.toBeNull();
	});

	it("delivers the note attached to a chosen option", async () => {
		const pending = call("ask_user", { title: "T", questions, wait_seconds: 5 });
		await waitForSession();
		const session = (await store.listOpen(LOCAL_USER_ID))[0]!;
		await store.submit(LOCAL_USER_ID, session.id, {
			choix: { selected: ["b"], text: "", notes: { b: "seulement pour le module X" } },
			libre: { selected: [], text: "ok" },
		});
		const { json } = await pending;
		expect(json.answers).toMatchObject([
			{ question_id: "choix", selected: [{ id: "b", label: "B", note: "seulement pour le module X" }] },
			{ question_id: "libre" },
		]);
	});

	it("relays a decline with its reason", async () => {
		const pending = call("ask_user", { title: "T", questions, wait_seconds: 5 });
		await waitForSession();
		await store.decline(LOCAL_USER_ID, (await store.listOpen(LOCAL_USER_ID))[0]!.id, "pas maintenant");
		expect((await pending).json).toMatchObject({ status: "declined", reason: "pas maintenant" });
	});

	it("rejects duplicate question ids", async () => {
		const { isError } = await call("ask_user", { questions: [textQuestion(), textQuestion()], wait_seconds: 0 });
		expect(isError).toBe(true);
	});

	it("rejects a malformed question (choice without options)", async () => {
		const { isError } = await call("ask_user", {
			questions: [{ id: "q", prompt: "?", type: "single" }],
			wait_seconds: 0,
		});
		expect(isError).toBe(true);
	});
});

describe("update_questions", () => {
	it("modifies a pending session and increments the revision", async () => {
		const first = await call("ask_user", { title: "T", questions, wait_seconds: 0 });
		const id = first.json.session_id as string;
		const edited = await call("update_questions", {
			session_id: id,
			title: "T2",
			questions: [textQuestion({ prompt: "Reformulée" })],
			wait_seconds: 0,
		});
		expect(edited.json).toMatchObject({ status: "pending", session_id: id });
		expect(await store.get(LOCAL_USER_ID, id)).toMatchObject({ title: "T2", revision: 1 });
		expect((await store.get(LOCAL_USER_ID, id))?.questions[0]?.prompt).toBe("Reformulée");
	});

	it("announces nothing to tabs: only the page of the session concerned updates", async () => {
		const first = await call("ask_user", { title: "T", questions, wait_seconds: 0 });
		const announce = vi.spyOn(hub, "announce");
		await call("update_questions", {
			session_id: first.json.session_id,
			questions: [textQuestion()],
			wait_seconds: 0,
		});
		expect(announce).not.toHaveBeenCalled();
	});

	it("wakes the wait with the answers given after the edit", async () => {
		const first = await call("ask_user", { title: "T", questions, wait_seconds: 0 });
		const id = first.json.session_id as string;
		const pending = call("update_questions", { session_id: id, questions: [textQuestion()], wait_seconds: 5 });
		await waitForRevision(id, 1);
		await store.submit(LOCAL_USER_ID, id, { libre: { selected: [], text: "ok" } });
		expect((await pending).json.status).toBe("answered");
	});

	it("refuses to edit an already answered session and points to get_answers", async () => {
		const first = await call("ask_user", { title: "T", questions, wait_seconds: 0 });
		const id = first.json.session_id as string;
		await store.submit(LOCAL_USER_ID, id, {
			choix: { selected: ["a"], text: "" },
			libre: { selected: [], text: "ok" },
		});
		const response = await call("update_questions", {
			session_id: id,
			questions: [textQuestion()],
			wait_seconds: 0,
		});
		expect(response.isError).toBe(true);
		expect(response.text).toContain("get_answers");
	});

	it("rejects an unknown session", async () => {
		const response = await call("update_questions", {
			session_id: "00000000-0000-4000-8000-000000000000",
			questions: [textQuestion()],
			wait_seconds: 0,
		});
		expect(response.isError).toBe(true);
	});
});

describe("get_answers", () => {
	it("returns pending until the user has answered", async () => {
		const first = await call("ask_user", { title: "T", questions, wait_seconds: 0 });
		const response = await call("get_answers", { session_id: first.json.session_id, wait_seconds: 0 });
		expect(response.json.status).toBe("pending");
	});

	it("returns the answers of an answered session after a pending", async () => {
		const first = await call("ask_user", { title: "T", questions, wait_seconds: 0 });
		const id = first.json.session_id as string;
		await store.submit(LOCAL_USER_ID, id, {
			choix: { selected: ["a"], text: "" },
			libre: { selected: [], text: "ok" },
		});
		const response = await call("get_answers", { session_id: id, wait_seconds: 0 });
		expect(response.json.status).toBe("answered");
	});

	it("rejects an unknown session", async () => {
		const response = await call("get_answers", { session_id: "00000000-0000-4000-8000-000000000000" });
		expect(response.isError).toBe(true);
	});
});

async function waitForSession(): Promise<void> {
	await waitFor(async () => (await store.listOpen(LOCAL_USER_ID)).length > 0);
}
async function waitForRevision(id: string, revision: number): Promise<void> {
	await waitFor(async () => ((await store.get(LOCAL_USER_ID, id))?.revision ?? 0) >= revision);
}
async function waitFor(condition: () => Promise<boolean>): Promise<void> {
	for (let i = 0; i < 100; i++) {
		if (await condition()) {
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	throw new Error("condition jamais remplie");
}
