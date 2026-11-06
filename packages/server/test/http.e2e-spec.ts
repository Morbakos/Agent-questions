import { get } from "node:http";
import type { AddressInfo } from "node:net";
import { MikroORM } from "@mikro-orm/core";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LOCAL_USER_ID } from "@app/auth/domain/principal.js";
import { SessionsService } from "@app/sessions/sessions.service.js";
import { singleQuestion, testConfig, textQuestion, createTestApplication } from "@server/test-helpers.js";
import { UiHub } from "@app/events/ui-hub.js";

const headers = { host: "127.0.0.1:4317" };
let app: NestFastifyApplication;
let store: SessionsService;

const inject = (options: Record<string, unknown>) =>
	app
		.getHttpAdapter()
		.getInstance()
		.inject({ ...options, headers: { ...headers, ...((options.headers as object) ?? {}) } });

const create = async () =>
	(await store.findOrCreate(LOCAL_USER_ID, { title: "T", questions: [singleQuestion(), textQuestion()] })).session;

beforeEach(async () => {
	app = await createTestApplication({ config: testConfig(), hub: new UiHub() });
	store = app.get(SessionsService);
	await app.init();
	await app.getHttpAdapter().getInstance().ready();
});
afterEach(async () => app.close());

describe("Host / Origin guard and health", () => {
	it("rejects an unknown Host header", async () => {
		const response = await inject({ method: "GET", url: "/api/sessions", headers: { host: "evil.example:4317" } });
		expect(response.statusCode).toBe(403);
	});

	it("rejects a disallowed Origin", async () => {
		const response = await inject({
			method: "GET",
			url: "/api/sessions",
			headers: { origin: "http://evil.example" },
		});
		expect(response.statusCode).toBe(403);
	});

	it("never accepts the origin * as a request value", async () => {
		const response = await inject({ method: "GET", url: "/api/sessions", headers: { origin: "*" } });
		expect(response.statusCode).toBe(403);
	});

	it("accepts the host and origin of the configured public URL, and only those", async () => {
		const other = await createTestApplication({
			config: testConfig({ baseUrl: "https://questions.example.com", port: 4317 }),
			hub: new UiHub(),
		});
		await other.init();
		await other.getHttpAdapter().getInstance().ready();
		try {
			const call = (headers: Record<string, string>) =>
				other.getHttpAdapter().getInstance().inject({ method: "GET", url: "/health", headers });
			expect(
				(await call({ host: "questions.example.com", origin: "https://questions.example.com" })).statusCode,
			).toBe(200);
			expect((await call({ host: "questions.example.com", origin: "https://evil.example" })).statusCode).toBe(
				403,
			);
			expect((await call({ host: "evil.example" })).statusCode).toBe(403);
		} finally {
			await other.close();
		}
	});

	it("allows the local origin and sets the CORS headers", async () => {
		const response = await inject({
			method: "GET",
			url: "/api/sessions",
			headers: { origin: "http://127.0.0.1:4317" },
		});
		expect(response.statusCode).toBe(200);
		expect(response.headers["access-control-allow-origin"]).toBe("http://127.0.0.1:4317");
	});

	it("answers the CORS preflight", async () => {
		const response = await inject({
			method: "OPTIONS",
			url: "/mcp",
			headers: { origin: "http://127.0.0.1:4317", "access-control-request-method": "POST" },
		});
		expect(response.statusCode).toBe(204);
	});

	it("exposes /health", async () => {
		const response = await inject({ method: "GET", url: "/health" });
		expect(response.statusCode).toBe(200);
		expect(response.json()).toMatchObject({ status: "ok", info: { database: { status: "up" } } });
	});

	it("answers 503 on /health when the database is closed", async () => {
		await app.get(MikroORM).close();
		const response = await inject({ method: "GET", url: "/health" });
		expect(response.statusCode).toBe(503);
		expect(response.json()).toMatchObject({ status: "error", error: { database: { status: "down" } } });
	});
});

describe("UI API", () => {
	it("lists pending sessions", async () => {
		const session = await create();
		const response = await inject({ method: "GET", url: "/api/sessions" });
		expect(response.json()).toEqual([expect.objectContaining({ id: session.id, title: "T", questionCount: 2 })]);
	});

	it("lists the history and rejects an invalid cursor", async () => {
		const session = (await store.findOrCreate(LOCAL_USER_ID, { title: "Fermée", questions: [textQuestion()] }))
			.session;
		await store.decline(LOCAL_USER_ID, session.id, "non");
		const response = await inject({ method: "GET", url: "/api/sessions/history" });
		expect(response.json()).toMatchObject({
			nextBefore: null,
			items: [expect.objectContaining({ id: session.id, title: "Fermée", status: "declined" })],
		});
		expect((await inject({ method: "GET", url: "/api/sessions/history?before=abc" })).statusCode).toBe(400);
		expect((await inject({ method: "GET", url: "/api/sessions/history?before=42" })).statusCode).toBe(400);
		expect((await inject({ method: "GET", url: "/api/sessions/history?before=42:abc" })).statusCode).toBe(200);
	});

	it("returns a session or 404", async () => {
		const session = await create();
		expect((await inject({ method: "GET", url: `/api/sessions/${session.id}` })).json()).toMatchObject({
			id: session.id,
			status: "pending",
			revision: 0,
		});
		expect((await inject({ method: "GET", url: "/api/sessions/inconnu" })).statusCode).toBe(404);
	});

	it("stores drafts and validates answers", async () => {
		const session = await create();
		const draft = await inject({
			method: "PUT",
			url: `/api/sessions/${session.id}/draft`,
			payload: { choix: { selected: ["a"], text: "" } },
		});
		expect(draft.statusCode).toBe(200);
		expect((await store.get(LOCAL_USER_ID, session.id))?.draft.choix?.selected).toEqual(["a"]);
		expect(
			(await inject({ method: "PUT", url: `/api/sessions/${session.id}/draft`, payload: [1, 2] })).statusCode,
		).toBe(400);
		expect(
			(await inject({ method: "POST", url: `/api/sessions/${session.id}/answers`, payload: {} })).statusCode,
		).toBe(422);
		const answers = { choix: { selected: ["a"], text: "" }, libre: { selected: [], text: "ok" } };
		expect(
			(await inject({ method: "POST", url: `/api/sessions/${session.id}/answers`, payload: answers })).statusCode,
		).toBe(200);
		expect(
			(await inject({ method: "POST", url: `/api/sessions/${session.id}/answers`, payload: answers })).statusCode,
		).toBe(409);
	});

	it("stores a decline and exposes edits", async () => {
		const session = await create();
		expect(
			(
				await inject({
					method: "POST",
					url: `/api/sessions/${session.id}/decline`,
					payload: { reason: "non merci" },
				})
			).statusCode,
		).toBe(200);
		const open = (
			await store.findOrCreate(LOCAL_USER_ID, {
				title: "Autre",
				questions: [textQuestion({ id: "autre" })],
			})
		).session;
		await store.updateQuestions(LOCAL_USER_ID, open.id, undefined, [textQuestion()]);
		expect((await inject({ method: "GET", url: `/api/sessions/${open.id}` })).json().revision).toBe(1);
	});
});

describe("UI SSE events", () => {
	it("announces new sessions to a connected tab", async () => {
		const hub = new UiHub();
		const live = await createTestApplication({ config: testConfig(), hub });
		try {
			await live.listen(0, "127.0.0.1");
			const address = live.getHttpServer().address() as AddressInfo;
			let received = "";
			let announced = false;
			const contentType = await new Promise<string | undefined>((resolve) => {
				const request = get(
					{ host: "127.0.0.1", port: address.port, path: "/api/events", headers },
					(response) => {
						response.setEncoding("utf8");
						response.on("data", (chunk: string) => {
							received += chunk;
							// Announces once the connection is confirmed, then stops as soon as the event has arrived.
							if (!announced && received.includes(": connecté")) {
								announced = true;
								hub.announce(LOCAL_USER_ID, { id: "s1", title: "Titre" });
							} else if (received.includes("event: new-session")) {
								request.destroy();
								resolve(response.headers["content-type"]);
							}
						});
					},
				);
			});
			expect(contentType).toContain("text/event-stream");
			expect(received).toContain(": connecté");
			expect(received).toContain("event: new-session");
			expect(received).toContain('"sessionId":"s1"');
		} finally {
			await live.close();
		}
	});
});
