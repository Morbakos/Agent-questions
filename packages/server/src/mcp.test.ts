import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AppConfig } from "./config.js";
import { createMcpServer } from "./mcp.js";
import { SessionStore } from "./sessions.js";
import { singleQuestion, testConfig, textQuestion } from "./test-helpers.js";

let store: SessionStore;
let client: Client;

async function connect(cfg: AppConfig = testConfig()): Promise<void> {
	const server = createMcpServer(store, cfg);
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	client = new Client({ name: "test", version: "0.0.0" });
	await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
}

/** Appelle un outil et renvoie le JSON de sa réponse (ou le message d'erreur). */
async function call(name: string, args: Record<string, unknown>) {
	const result = await client.callTool({ name, arguments: args });
	const text = (result.content as { type: string; text: string }[])[0]?.text ?? "";
	return { isError: result.isError === true, text, json: result.isError ? undefined : JSON.parse(text) };
}

beforeEach(async () => {
	store = new SessionStore(":memory:");
	await connect();
});

afterEach(async () => {
	await client.close();
});

const questions = [singleQuestion(), textQuestion()];

describe("tools/list", () => {
	it("expose les trois outils", async () => {
		const { tools } = await client.listTools();
		expect(tools.map((t) => t.name).sort()).toEqual(["ask_user", "get_answers", "update_questions"]);
	});

	it("demande à l'agent de donner l'adresse de l'UI quand noOpen est actif", async () => {
		await client.close();
		await connect(testConfig({ noOpen: true, baseUrl: "http://exemple:4317" }));
		expect(client.getInstructions()).toContain("http://exemple:4317");
	});
});

describe("ask_user", () => {
	it("renvoie pending avec l'adresse de la session quand personne ne répond", async () => {
		const { json } = await call("ask_user", { title: "T", questions, wait_seconds: 0 });
		expect(json.status).toBe("pending");
		expect(json.url).toBe(`http://127.0.0.1:4317/s/${json.session_id}`);
	});

	it("reste idempotent : mêmes questions, même session", async () => {
		const a = await call("ask_user", { title: "T", questions, wait_seconds: 0 });
		const b = await call("ask_user", { title: "T", questions, wait_seconds: 0 });
		expect(b.json.session_id).toBe(a.json.session_id);
	});

	it("se termine dès que l'utilisateur répond et livre les libellés", async () => {
		const pending = call("ask_user", { title: "T", questions, wait_seconds: 5 });
		await waitForSession();
		const [session] = store.listOpen();
		store.submit(session!.id, { choix: { selected: ["b"], text: "" }, libre: { selected: [], text: "parce que" } });
		const { json } = await pending;
		expect(json.status).toBe("answered");
		expect(json.answers).toEqual([
			{ question_id: "choix", selected: [{ id: "b", label: "B" }] },
			{ question_id: "libre", selected: [], text: "parce que" },
		]);
		expect(store.get(session!.id)?.deliveredAt).not.toBeNull();
	});

	it("transmet un refus avec sa raison", async () => {
		const pending = call("ask_user", { title: "T", questions, wait_seconds: 5 });
		await waitForSession();
		store.decline(store.listOpen()[0]!.id, "pas maintenant");
		const { json } = await pending;
		expect(json).toMatchObject({ status: "declined", reason: "pas maintenant" });
	});

	it("refuse des identifiants de question en double", async () => {
		const { isError } = await call("ask_user", { questions: [textQuestion(), textQuestion()], wait_seconds: 0 });
		expect(isError).toBe(true);
	});

	it("refuse une question mal formée (choix sans options)", async () => {
		const { isError } = await call("ask_user", {
			questions: [{ id: "q", prompt: "?", type: "single" }],
			wait_seconds: 0,
		});
		expect(isError).toBe(true);
	});
});

describe("update_questions", () => {
	it("modifie une session en attente et incrémente la révision", async () => {
		const first = await call("ask_user", { title: "T", questions, wait_seconds: 0 });
		const id = first.json.session_id as string;
		const edited = await call("update_questions", {
			session_id: id,
			title: "T2",
			questions: [textQuestion({ prompt: "Reformulée" })],
			wait_seconds: 0,
		});
		expect(edited.json).toMatchObject({ status: "pending", session_id: id });
		expect(store.get(id)).toMatchObject({ title: "T2", revision: 1 });
		expect(store.get(id)?.questions[0]?.prompt).toBe("Reformulée");
	});

	it("réveille l'attente avec les réponses données après l'édition", async () => {
		const first = await call("ask_user", { title: "T", questions, wait_seconds: 0 });
		const id = first.json.session_id as string;
		const pending = call("update_questions", {
			session_id: id,
			questions: [textQuestion()],
			wait_seconds: 5,
		});
		await waitForRevision(id, 1);
		store.submit(id, { libre: { selected: [], text: "ok" } });
		expect((await pending).json.status).toBe("answered");
	});

	it("refuse d'éditer une session déjà répondue et renvoie vers get_answers", async () => {
		const first = await call("ask_user", { title: "T", questions, wait_seconds: 0 });
		const id = first.json.session_id as string;
		store.submit(id, { choix: { selected: ["a"], text: "" }, libre: { selected: [], text: "ok" } });
		const res = await call("update_questions", { session_id: id, questions: [textQuestion()], wait_seconds: 0 });
		expect(res.isError).toBe(true);
		expect(res.text).toContain("get_answers");
	});

	it("refuse une session inconnue", async () => {
		const res = await call("update_questions", {
			session_id: "00000000-0000-4000-8000-000000000000",
			questions: [textQuestion()],
			wait_seconds: 0,
		});
		expect(res.isError).toBe(true);
	});
});

describe("get_answers", () => {
	it("renvoie pending tant que l'utilisateur n'a pas répondu", async () => {
		const first = await call("ask_user", { title: "T", questions, wait_seconds: 0 });
		const res = await call("get_answers", { session_id: first.json.session_id, wait_seconds: 0 });
		expect(res.json.status).toBe("pending");
	});

	it("renvoie les réponses d'une session répondue après un pending", async () => {
		const first = await call("ask_user", { title: "T", questions, wait_seconds: 0 });
		const id = first.json.session_id as string;
		store.submit(id, { choix: { selected: ["a"], text: "" }, libre: { selected: [], text: "ok" } });
		const res = await call("get_answers", { session_id: id, wait_seconds: 0 });
		expect(res.json.status).toBe("answered");
	});

	it("refuse une session inconnue", async () => {
		const res = await call("get_answers", { session_id: "00000000-0000-4000-8000-000000000000" });
		expect(res.isError).toBe(true);
	});
});

/** Laisse le temps à l'appel d'outil de créer sa session avant d'agir sur la base. */
async function waitForSession(): Promise<void> {
	await waitFor(() => store.listOpen().length > 0);
}

async function waitForRevision(id: string, revision: number): Promise<void> {
	await waitFor(() => (store.get(id)?.revision ?? 0) >= revision);
}

async function waitFor(condition: () => boolean): Promise<void> {
	for (let i = 0; i < 100; i++) {
		if (condition()) return;
		await new Promise((r) => setTimeout(r, 10));
	}
	throw new Error("condition jamais remplie");
}
