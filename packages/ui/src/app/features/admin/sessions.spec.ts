import { HttpErrorResponse } from "@angular/common/http";
import { provideRouter } from "@angular/router";
import { TestBed } from "@angular/core/testing";
import type { AdminSessionSummary } from "@agent-questions/shared";
import { ApiService } from "../../core/api";
import { button } from "../../../testing/dom";
import { AdminSessionsComponent } from "./sessions";

const item = (overrides: Partial<AdminSessionSummary>): AdminSessionSummary => ({
	id: "s1",
	title: "Choix de la base",
	status: "pending",
	createdAt: 1_700_000_000_000,
	answeredAt: null,
	questionCount: 2,
	ownerId: "u2",
	ownerUsername: "bob",
	...overrides,
});

describe("AdminSessionsComponent", () => {
	const api = { adminSessions: vi.fn() };

	beforeEach(() => {
		api.adminSessions.mockReset();
		TestBed.configureTestingModule({ providers: [{ provide: ApiService, useValue: api }, provideRouter([])] });
	});

	async function render() {
		const fixture = TestBed.createComponent(AdminSessionsComponent);
		await fixture.whenStable();
		fixture.detectChanges();
		return { fixture, el: fixture.nativeElement as HTMLElement };
	}

	it("lists the sessions with their owner, without any action button", async () => {
		api.adminSessions.mockResolvedValue({ items: [item({})], nextBefore: null });
		const { el } = await render();
		const row = el.querySelector("tbody tr")?.textContent ?? "";
		expect(row).toContain("Choix de la base");
		expect(row).toContain("bob");
		expect(row).toContain("En attente");
		expect(el.querySelector("tbody button")).toBeNull();
		expect(el.textContent).not.toContain("Voir plus");
	});

	it("shows the error, and not « Aucune session », when the first load fails", async () => {
		api.adminSessions.mockRejectedValue(
			new HttpErrorResponse({ status: 403, error: { error: "Droits insuffisants" } }),
		);
		const { el } = await render();
		expect(el.querySelector('[role="alert"]')?.textContent).toContain("Droits insuffisants");
		expect(el.textContent).not.toContain("Aucune session");
	});

	it("shows « Aucune session » when there really is none", async () => {
		api.adminSessions.mockResolvedValue({ items: [], nextBefore: null });
		const { el } = await render();
		expect(el.textContent).toContain("Aucune session");
	});

	it('keeps the rows already loaded when "Voir plus" fails, and does not duplicate a session', async () => {
		api.adminSessions
			.mockResolvedValueOnce({ items: [item({})], nextBefore: "10:a" })
			.mockRejectedValueOnce(new HttpErrorResponse({ status: 500 }))
			.mockResolvedValueOnce({ items: [item({}), item({ id: "s2", title: "Autre" })], nextBefore: null });
		const { fixture, el } = await render();
		button(el, "Voir plus").click();
		await fixture.whenStable();
		fixture.detectChanges();
		expect(el.querySelectorAll("tbody tr")).toHaveLength(1);
		expect(el.querySelector('[role="alert"]')).not.toBeNull();
		button(el, "Voir plus").click();
		await fixture.whenStable();
		fixture.detectChanges();
		expect(el.querySelectorAll("tbody tr")).toHaveLength(2);
		expect(el.querySelector('[role="alert"]')).toBeNull();
	});

	it("loads the next page with the cursor", async () => {
		api.adminSessions
			.mockResolvedValueOnce({ items: [item({})], nextBefore: "1234:a" })
			.mockResolvedValueOnce({ items: [item({ id: "s2", title: "Autre" })], nextBefore: null });
		const { fixture, el } = await render();
		button(el, "Voir plus").click();
		await fixture.whenStable();
		fixture.detectChanges();
		expect(api.adminSessions).toHaveBeenLastCalledWith("1234:a");
		expect(el.querySelectorAll("tbody tr")).toHaveLength(2);
		expect(el.textContent).not.toContain("Voir plus");
	});
});
