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

	describe("historique", () => {
		const closed = (id: string, overrides: Parameters<typeof sessionSummary>[0] = {}) =>
			sessionSummary({ id, title: `Passée ${id}`, status: "answered", answeredAt: 1000, ...overrides });
		const items = (el: HTMLElement) => Array.from(el.querySelectorAll(".history-list a"));

		it("n'affiche pas la section quand il n'y a aucune session passée", async () => {
			api.list.mockResolvedValue([]);
			const { el } = await render();
			expect(el.querySelector(".history-title")).toBeNull();
		});

		it("liste les sessions passées avec leur statut et un lien vers le détail", async () => {
			api.list.mockResolvedValue([]);
			api.history.mockResolvedValue({
				items: [closed("a"), closed("b", { status: "declined" })],
				nextBefore: null,
			});
			const { el } = await render();
			expect(items(el).map((a) => a.getAttribute("href"))).toEqual(["/s/a", "/s/b"]);
			expect(items(el)[0]?.textContent).toContain("répondue le");
			expect(items(el)[1]?.textContent).toContain("refusée le");
			expect(Array.from(el.querySelectorAll("button")).some((b) => b.textContent?.includes("Charger plus"))).toBe(
				false,
			);
		});

		it("charge la page suivante à la demande, sans doublon", async () => {
			api.list.mockResolvedValue([]);
			api.history
				.mockResolvedValueOnce({ items: [closed("a")], nextBefore: 1000 })
				.mockResolvedValueOnce({ items: [closed("a"), closed("b")], nextBefore: null });
			const { fixture, el } = await render();
			const more = el.querySelector<HTMLButtonElement>("button")!;
			expect(more.textContent).toContain("Charger plus");

			more.click();
			await vi.advanceTimersByTimeAsync(0);
			fixture.detectChanges();
			expect(api.history).toHaveBeenLastCalledWith(1000);
			expect(items(el).map((a) => a.getAttribute("href"))).toEqual(["/s/a", "/s/b"]);
			expect(el.querySelector("button")).toBeNull();
		});

		it("ne recharge l'historique que lorsque la liste des questions en attente change", async () => {
			api.list.mockResolvedValue([sessionSummary({ id: "p1" })]);
			const { fixture, el } = await render();
			expect(api.history).toHaveBeenCalledTimes(1);

			await vi.advanceTimersByTimeAsync(REFRESH_MS);
			expect(api.history).toHaveBeenCalledTimes(1);

			api.list.mockResolvedValue([]);
			api.history.mockResolvedValue({ items: [closed("p1")], nextBefore: null });
			await vi.advanceTimersByTimeAsync(REFRESH_MS);
			fixture.detectChanges();
			expect(api.history).toHaveBeenCalledTimes(2);
			expect(items(el).map((a) => a.getAttribute("href"))).toEqual(["/s/p1"]);
		});

		it("réessaie au tour suivant quand le premier chargement échoue", async () => {
			api.list.mockResolvedValue([]);
			api.history
				.mockRejectedValueOnce(new Error("réseau"))
				.mockResolvedValue({ items: [closed("a")], nextBefore: null });
			const { fixture, el } = await render();
			expect(items(el)).toHaveLength(0);

			await vi.advanceTimersByTimeAsync(REFRESH_MS);
			fixture.detectChanges();
			expect(items(el)).toHaveLength(1);
		});
	});

	it("arrête de sonder quand le composant est détruit", async () => {
		api.list.mockResolvedValue([]);
		const { fixture } = await render();
		fixture.destroy();
		await vi.advanceTimersByTimeAsync(REFRESH_MS * 3);
		expect(api.list).toHaveBeenCalledTimes(1);
	});
});
