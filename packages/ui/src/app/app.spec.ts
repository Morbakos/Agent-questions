import { signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import type { UiNewSessionEvent } from "@agent-questions/shared";
import { App } from "./app";
import { LiveService } from "./core/live";

describe("App", () => {
	const offer = signal<UiNewSessionEvent | null>(null);
	const live = { offer, start: vi.fn(), open: vi.fn(), dismiss: vi.fn() };

	beforeEach(() => {
		offer.set(null);
		vi.clearAllMocks();
		TestBed.configureTestingModule({
			providers: [provideRouter([]), { provide: LiveService, useValue: live }],
		});
	});

	async function render() {
		const fixture = TestBed.createComponent(App);
		await fixture.whenStable();
		return { fixture, el: fixture.nativeElement as HTMLElement };
	}

	it("affiche l'en-tête avec un lien vers la liste", async () => {
		const { el } = await render();
		const brand = el.querySelector<HTMLAnchorElement>("a.brand");
		expect(brand?.textContent).toBe("Questions de l'agent");
		expect(brand?.getAttribute("href")).toBe("/");
	});

	it("écoute le flux d'événements du serveur", async () => {
		await render();
		expect(live.start).toHaveBeenCalledOnce();
	});

	it("n'affiche aucune proposition par défaut", async () => {
		const { el } = await render();
		expect(el.querySelector(".toast")).toBeNull();
	});

	it("propose d'aller sur les nouvelles questions, ou de les ignorer", async () => {
		offer.set({ sessionId: "abc", title: "Choix du back" });
		const { fixture, el } = await render();
		expect(el.querySelector(".toast")?.textContent).toContain("Choix du back");

		const [go, ignore] = Array.from(el.querySelectorAll<HTMLButtonElement>(".toast button"));
		go!.click();
		expect(live.open).toHaveBeenCalledOnce();
		ignore!.click();
		expect(live.dismiss).toHaveBeenCalledOnce();

		offer.set(null);
		fixture.detectChanges();
		expect(el.querySelector(".toast")).toBeNull();
	});
});
