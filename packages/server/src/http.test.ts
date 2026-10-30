import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./http.js";
import { SessionStore } from "./session-store.js";
import { singleQuestion, testConfig, textQuestion } from "./test-helpers.js";

let app: FastifyInstance;
let store: SessionStore;

const headers = { host: "127.0.0.1:4317" };

beforeEach(async () => {
	process.env.AQ_LOG = "silent";
	store = new SessionStore(":memory:");
	app = await buildApp(store, testConfig());
});

afterEach(async () => {
	await app.close();
});

const create = () => store.findOrCreate({ title: "T", questions: [singleQuestion(), textQuestion()] }).session;

describe("garde Host / Origin", () => {
	it("refuse un en-tête Host inconnu (DNS rebinding)", async () => {
		const res = await app.inject({ method: "GET", url: "/api/sessions", headers: { host: "evil.example:4317" } });
		expect(res.statusCode).toBe(403);
	});

	it("refuse une Origin non autorisée", async () => {
		const res = await app.inject({
			method: "GET",
			url: "/api/sessions",
			headers: { ...headers, origin: "http://evil.example" },
		});
		expect(res.statusCode).toBe(403);
	});

	it("autorise l'origine du serveur et pose les en-têtes CORS", async () => {
		const res = await app.inject({
			method: "GET",
			url: "/api/sessions",
			headers: { ...headers, origin: "http://127.0.0.1:4317" },
		});
		expect(res.statusCode).toBe(200);
		expect(res.headers["access-control-allow-origin"]).toBe("http://127.0.0.1:4317");
	});

	it("répond au pré-vol CORS d'une origine autorisée", async () => {
		const res = await app.inject({
			method: "OPTIONS",
			url: "/mcp",
			headers: { ...headers, origin: "http://127.0.0.1:4317" },
		});
		expect(res.statusCode).toBe(204);
	});
});

describe("API de l'UI", () => {
	it("liste les sessions en attente", async () => {
		const s = create();
		const res = await app.inject({ method: "GET", url: "/api/sessions", headers });
		expect(res.json()).toEqual([expect.objectContaining({ id: s.id, title: "T", questionCount: 2 })]);
	});

	it("liste l'historique des sessions clôturées, sans les sessions en attente", async () => {
		const open = create();
		const closed = store.findOrCreate({ title: "Fermée", questions: [textQuestion()] }).session;
		store.decline(closed.id, "non");
		const res = await app.inject({ method: "GET", url: "/api/sessions/history", headers });
		expect(res.statusCode).toBe(200);
		const body = res.json();
		expect(body.nextBefore).toBeNull();
		expect(body.items).toEqual([expect.objectContaining({ id: closed.id, title: "Fermée", status: "declined" })]);
		expect(body.items.map((s: { id: string }) => s.id)).not.toContain(open.id);
	});

	it("refuse un curseur d'historique invalide (400)", async () => {
		const res = await app.inject({ method: "GET", url: "/api/sessions/history?before=abc", headers });
		expect(res.statusCode).toBe(400);
	});

	it("renvoie la vue d'une session, avec sa révision, et la marque comme vue", async () => {
		const s = create();
		const res = await app.inject({ method: "GET", url: `/api/sessions/${s.id}`, headers });
		expect(res.json()).toMatchObject({ id: s.id, status: "pending", revision: 0, answers: null });
		expect(store.get(s.id)?.lastSeenAt).not.toBeNull();
	});

	it("répond 404 pour une session inconnue", async () => {
		const res = await app.inject({ method: "GET", url: "/api/sessions/inconnu", headers });
		expect(res.statusCode).toBe(404);
	});

	it("enregistre un brouillon", async () => {
		const s = create();
		const res = await app.inject({
			method: "PUT",
			url: `/api/sessions/${s.id}/draft`,
			headers,
			payload: { choix: { selected: ["a"], text: "" } },
		});
		expect(res.statusCode).toBe(200);
		expect(store.get(s.id)?.draft.choix?.selected).toEqual(["a"]);
	});

	it("refuse un brouillon mal formé (400)", async () => {
		const s = create();
		const res = await app.inject({ method: "PUT", url: `/api/sessions/${s.id}/draft`, headers, payload: [1, 2] });
		expect(res.statusCode).toBe(400);
	});

	it("accepte des réponses valides puis refuse un second envoi (409)", async () => {
		const s = create();
		const answers = { choix: { selected: ["a"], text: "" }, libre: { selected: [], text: "ok" } };
		const first = await app.inject({
			method: "POST",
			url: `/api/sessions/${s.id}/answers`,
			headers,
			payload: answers,
		});
		expect(first.statusCode).toBe(200);
		expect(store.get(s.id)?.status).toBe("answered");
		const second = await app.inject({
			method: "POST",
			url: `/api/sessions/${s.id}/answers`,
			headers,
			payload: answers,
		});
		expect(second.statusCode).toBe(409);
	});

	it("refuse des réponses incomplètes (422) avec le détail", async () => {
		const s = create();
		const res = await app.inject({ method: "POST", url: `/api/sessions/${s.id}/answers`, headers, payload: {} });
		expect(res.statusCode).toBe(422);
		expect(res.json().details.length).toBeGreaterThan(0);
	});

	it("enregistre un refus de répondre", async () => {
		const s = create();
		const res = await app.inject({
			method: "POST",
			url: `/api/sessions/${s.id}/decline`,
			headers,
			payload: { reason: "non merci" },
		});
		expect(res.statusCode).toBe(200);
		expect(store.get(s.id)).toMatchObject({ status: "declined", declineReason: "non merci" });
	});

	it("expose la nouvelle révision après une édition par l'agent", async () => {
		const s = create();
		store.updateQuestions(s.id, undefined, [textQuestion()]);
		const res = await app.inject({ method: "GET", url: `/api/sessions/${s.id}`, headers });
		expect(res.json().revision).toBe(1);
	});
});

describe("divers", () => {
	it("répond sur /health", async () => {
		expect((await app.inject({ method: "GET", url: "/health", headers })).statusCode).toBe(200);
	});

	it("refuse GET et DELETE sur /mcp (serveur sans état)", async () => {
		expect((await app.inject({ method: "GET", url: "/mcp", headers })).statusCode).toBe(405);
		expect((await app.inject({ method: "DELETE", url: "/mcp", headers })).statusCode).toBe(405);
	});
});
