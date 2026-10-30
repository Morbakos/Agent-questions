import { provideHttpClient } from "@angular/common/http";
import { HttpTestingController, provideHttpClientTesting } from "@angular/common/http/testing";
import { TestBed } from "@angular/core/testing";
import { sessionSummary, sessionView } from "../../testing/fixtures";
import { ApiService } from "./api";

describe("ApiService", () => {
	let api: ApiService;
	let http: HttpTestingController;

	beforeEach(() => {
		TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
		api = TestBed.inject(ApiService);
		http = TestBed.inject(HttpTestingController);
	});

	afterEach(() => http.verify());

	it("liste les sessions en attente", async () => {
		const result = api.list();
		http.expectOne({ method: "GET", url: "/api/sessions" }).flush([sessionSummary()]);
		expect(await result).toEqual([sessionSummary()]);
	});

	it("lit une page de l'historique, avec ou sans curseur", async () => {
		const first = api.history();
		http.expectOne({ method: "GET", url: "/api/sessions/history" }).flush({ items: [], nextBefore: 42 });
		expect(await first).toEqual({ items: [], nextBefore: 42 });

		const next = api.history(42);
		http.expectOne({ method: "GET", url: "/api/sessions/history?before=42" }).flush({
			items: [],
			nextBefore: null,
		});
		await next;
	});

	it("lit une session", async () => {
		const result = api.get("s1");
		http.expectOne({ method: "GET", url: "/api/sessions/s1" }).flush(sessionView());
		expect((await result).title).toBe("Ma session");
	});

	it("envoie le brouillon en PUT", async () => {
		const draft = { choix: { selected: ["a"], text: "" } };
		const result = api.saveDraft("s1", draft);
		const req = http.expectOne({ method: "PUT", url: "/api/sessions/s1/draft" });
		expect(req.request.body).toEqual(draft);
		req.flush({ ok: true });
		await result;
	});

	it("envoie les réponses en POST", async () => {
		const answers = { choix: { selected: ["b"], text: "" } };
		const result = api.submit("s1", answers);
		const req = http.expectOne({ method: "POST", url: "/api/sessions/s1/answers" });
		expect(req.request.body).toEqual(answers);
		req.flush({ ok: true });
		await result;
	});

	it("transmet le motif du refus", async () => {
		const result = api.decline("s1", "pas le temps");
		const req = http.expectOne({ method: "POST", url: "/api/sessions/s1/decline" });
		expect(req.request.body).toEqual({ reason: "pas le temps" });
		req.flush({ ok: true });
		await result;
	});

	it("rejette la promesse quand le serveur répond en erreur", async () => {
		const result = api.get("inconnue");
		http.expectOne("/api/sessions/inconnue").flush(
			{ error: "Session introuvable" },
			{ status: 404, statusText: "Not Found" },
		);
		await expect(result).rejects.toMatchObject({ status: 404 });
	});
});
