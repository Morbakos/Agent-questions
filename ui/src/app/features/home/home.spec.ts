import { TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { type ApiMock, apiMock, sessionSummary } from "../../../testing/fixtures";
import { ApiService } from "../../core/api";
import { HomeComponent, REFRESH_MS } from "./home";

describe("HomeComponent", () => {
	let api: ApiMock;

	beforeEach(() => {
		vi.useFakeTimers();
		api = apiMock();
		TestBed.configureTestingModule({
			providers: [provideRouter([]), { provide: ApiService, useValue: api }],
		});
	});

	afterEach(() => vi.useRealTimers());

	async function render() {
		const fixture = TestBed.createComponent(HomeComponent);
		await vi.advanceTimersByTimeAsync(0);
		await fixture.whenStable();
		return { fixture, el: fixture.nativeElement as HTMLElement };
	}

	it("explique comment une question apparaît quand la liste est vide", async () => {
		api.list.mockResolvedValue([]);
		const { el } = await render();
		expect(el.querySelector("h1")?.textContent).toBe("Questions en attente");
		expect(el.textContent).toContain("Aucune question en attente");
		expect(el.querySelectorAll(".session-list li")).toHaveLength(0);
	});

	it("liste les sessions avec un lien vers leur formulaire", async () => {
		api.list.mockResolvedValue([
			sessionSummary({ id: "abc", title: "Migration", questionCount: 3 }),
			sessionSummary({ id: "def", title: "Choix du back" }),
		]);
		const { el } = await render();
		const links = Array.from(el.querySelectorAll<HTMLAnchorElement>(".session-list a"));
		expect(links.map((a) => a.getAttribute("href"))).toEqual(["/s/abc", "/s/def"]);
		expect(links[0]?.textContent).toContain("Migration");
		expect(links[0]?.textContent).toContain("3 questions");
		expect(el.textContent).not.toContain("Aucune question en attente");
	});

	it("rafraîchit la liste à intervalle régulier", async () => {
		api.list.mockResolvedValueOnce([]).mockResolvedValue([sessionSummary({ title: "Nouvelle" })]);
		const { fixture, el } = await render();
		expect(el.querySelectorAll(".session-list li")).toHaveLength(0);

		await vi.advanceTimersByTimeAsync(REFRESH_MS);
		fixture.detectChanges();
		expect(api.list).toHaveBeenCalledTimes(2);
		expect(el.querySelector(".session-list")?.textContent).toContain("Nouvelle");
	});

	it("garde la liste affichée quand une actualisation échoue", async () => {
		api.list.mockResolvedValueOnce([sessionSummary({ title: "Stable" })]).mockRejectedValue(new Error("réseau"));
		const { fixture, el } = await render();
		await vi.advanceTimersByTimeAsync(REFRESH_MS);
		fixture.detectChanges();
		expect(el.querySelector(".session-list")?.textContent).toContain("Stable");
	});

	it("arrête de sonder quand le composant est détruit", async () => {
		api.list.mockResolvedValue([]);
		const { fixture } = await render();
		fixture.destroy();
		await vi.advanceTimersByTimeAsync(REFRESH_MS * 3);
		expect(api.list).toHaveBeenCalledTimes(1);
	});
});
