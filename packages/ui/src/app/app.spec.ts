import { signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import type { UiNewSessionEvent } from "@agent-questions/shared";
import { App } from "./app";
import { AuthService } from "./core/auth";
import { LiveService } from "./core/live";

describe("App", () => {
	const offer = signal<UiNewSessionEvent | null>(null);
	const live = { offer, start: vi.fn(), open: vi.fn(), dismiss: vi.fn() };
	const isServer = signal(false);
	const isAdmin = signal(false);
	const auth = { isServer, isAdmin, me: signal({ username: "alice" }), load: vi.fn(), logout: vi.fn() };

	beforeEach(() => {
		offer.set(null);
		isServer.set(false);
		isAdmin.set(false);
		vi.clearAllMocks();
		TestBed.configureTestingModule({
			providers: [
				provideRouter([]),
				{ provide: LiveService, useValue: live },
				{ provide: AuthService, useValue: auth },
			],
		});
	});

	async function render() {
		const fixture = TestBed.createComponent(App);
		await fixture.whenStable();
		return { fixture, el: fixture.nativeElement as HTMLElement };
	}

	it("shows the header with a link to the list", async () => {
		const { el } = await render();
		const brand = el.querySelector<HTMLAnchorElement>("a.brand");
		expect(brand?.textContent).toBe("Questions de l'agent");
		expect(brand?.getAttribute("href")).toBe("/");
	});

	it("loads the identity, and shows no account menu in the local profile", async () => {
		const { el } = await render();
		expect(auth.load).toHaveBeenCalledOnce();
		expect(el.querySelector(".user")).toBeNull();
	});

	it("in the server profile, shows the account and sign-out, and the administration to admins only", async () => {
		isServer.set(true);
		const { fixture, el } = await render();
		const links = () => Array.from(el.querySelectorAll(".user a")).map((a) => a.textContent?.trim());
		expect(links()).toEqual(["alice"]);

		isAdmin.set(true);
		fixture.detectChanges();
		expect(links()).toEqual(["Sessions", "Utilisateurs", "alice"]);
		el.querySelector<HTMLButtonElement>(".user button")!.click();
		expect(auth.logout).toHaveBeenCalledOnce();
	});

	it("listens to the server's event stream", async () => {
		await render();
		expect(live.start).toHaveBeenCalledOnce();
	});

	it("shows no proposal by default", async () => {
		const { el } = await render();
		expect(el.querySelector(".toast")).toBeNull();
	});

	it("offers to go to the new questions, or to ignore them", async () => {
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
