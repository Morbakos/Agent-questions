import { TestBed } from "@angular/core/testing";
import { ActivatedRoute, provideRouter } from "@angular/router";
import type { AdminSessionView } from "@agent-questions/shared";
import { ApiService } from "../../core/api";
import { AdminSessionDetailComponent } from "./session-detail";

const session: AdminSessionView = {
	id: "s1",
	title: "Choix de la base",
	status: "answered",
	revision: 0,
	questions: [
		{
			id: "db",
			header: "Base",
			prompt: "Quelle **base** ?",
			type: "single",
			options: [
				{ id: "pg", label: "PostgreSQL" },
				{ id: "sq", label: "SQLite" },
			],
		},
	],
	draft: {},
	answers: { db: { selected: ["sq"], text: "pour commencer" } },
	declineReason: null,
	readOnly: true,
	ownerId: "u2",
	ownerUsername: "bob",
};

describe("AdminSessionDetailComponent", () => {
	const api = { adminSession: vi.fn() };

	beforeEach(() => {
		api.adminSession.mockReset();
		TestBed.configureTestingModule({
			providers: [
				provideRouter([]),
				{ provide: ApiService, useValue: api },
				{ provide: ActivatedRoute, useValue: { snapshot: { paramMap: new Map([["id", "s1"]]) } } },
			],
		});
	});

	async function render() {
		const fixture = TestBed.createComponent(AdminSessionDetailComponent);
		await fixture.whenStable();
		fixture.detectChanges();
		return fixture.nativeElement as HTMLElement;
	}

	it("shows the owner, the questions and the answers, read-only", async () => {
		api.adminSession.mockResolvedValue(session);
		const el = await render();
		expect(api.adminSession).toHaveBeenCalledWith("s1");
		expect(el.textContent).toContain("Lecture seule");
		expect(el.textContent).toContain("bob");
		expect(el.querySelector(".md strong")?.textContent).toBe("base");
		expect(el.querySelector("li")?.textContent?.trim()).toBe("SQLite");
		expect(el.querySelector("blockquote")?.textContent).toBe("pour commencer");
		expect(el.querySelector("button, input, textarea, select")).toBeNull();
	});

	it("shows the draft of a pending session, with an unknown option shown by its id", async () => {
		api.adminSession.mockResolvedValue({
			...session,
			status: "pending",
			answers: null,
			draft: { db: { selected: ["inconnue"], text: "" } },
		});
		const el = await render();
		expect(el.textContent).toContain("en attente");
		expect(el.querySelector("li")?.textContent?.trim()).toBe("inconnue");
	});

	it("shows the refusal and its reason, without an answer", async () => {
		api.adminSession.mockResolvedValue({
			...session,
			status: "declined",
			answers: null,
			declineReason: "pas le temps",
		});
		const el = await render();
		expect(el.textContent).toContain("refusée");
		expect(el.textContent).toContain("pas le temps");
		expect(el.textContent).toContain("Pas de réponse");
	});

	it("shows the error when the session is not found", async () => {
		api.adminSession.mockRejectedValue(new Error("x"));
		const el = await render();
		expect(el.querySelector('[role="alert"]')).not.toBeNull();
	});
});
