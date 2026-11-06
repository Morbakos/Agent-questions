import { TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { type ApiMock, apiMock, sessionSummary } from "../../../testing/fixtures";
import { ApiService } from "../../core/api";
import { HomeComponent, REFRESH_MS } from "./home";

describe("HomeComponent", () => {
	let api: ApiMock;

	beforeEach(() => {
		vi.useFakeTimers();
		vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
		api = apiMock();
		TestBed.configureTestingModule({
			providers: [provideRouter([]), { provide: ApiService, useValue: api }],
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.useRealTimers();
	});

	async function render() {
		const fixture = TestBed.createComponent(HomeComponent);
		await vi.advanceTimersByTimeAsync(0);
		await fixture.whenStable();
		return { fixture, el: fixture.nativeElement as HTMLElement };
	}

	it("explains how a question shows up when the list is empty", async () => {
		api.list.mockResolvedValue([]);
		const { el } = await render();
		expect(el.querySelector("h1")?.textContent).toBe("Questions en attente");
		expect(el.textContent).toContain("Aucune question en attente");
		expect(el.querySelectorAll(".session-list li")).toHaveLength(0);
	});

	it("shows « Chargement… » before the first response, not « Aucune question »", async () => {
		api.list.mockReturnValue(new Promise(() => undefined));
		const { el } = await render();
		expect(el.textContent).toContain("Chargement");
		expect(el.textContent).not.toContain("Aucune question en attente");
	});

	it("reports the load failure instead of showing an empty list, then recovers", async () => {
		api.list.mockRejectedValueOnce(new Error("réseau")).mockResolvedValue([sessionSummary({ title: "Revenue" })]);
		const { fixture, el } = await render();
		fixture.detectChanges();
		expect(el.querySelector('[role="alert"]')?.textContent).toContain("Impossible de charger");
		expect(el.textContent).not.toContain("Aucune question en attente");

		await vi.advanceTimersByTimeAsync(REFRESH_MS);
		fixture.detectChanges();
		expect(el.querySelector('[role="alert"]')).toBeNull();
		expect(el.textContent).toContain("Revenue");
	});

	it("does not pile up requests when the previous one has not come back", async () => {
		api.list.mockReturnValue(new Promise(() => undefined));
		await render();
		await vi.advanceTimersByTimeAsync(REFRESH_MS * 4);
		expect(api.list).toHaveBeenCalledTimes(1);
	});

	it("does not poll a hidden tab, and resumes when it becomes visible again", async () => {
		api.list.mockResolvedValue([]);
		await render();
		vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
		await vi.advanceTimersByTimeAsync(REFRESH_MS * 3);
		expect(api.list).toHaveBeenCalledTimes(1);
		vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
		await vi.advanceTimersByTimeAsync(REFRESH_MS);
		expect(api.list).toHaveBeenCalledTimes(2);
	});

	it("uses the singular for « 1 question »", async () => {
		api.list.mockResolvedValue([sessionSummary({ questionCount: 1 })]);
		const { el } = await render();
		expect(el.querySelector(".session-list a")?.textContent).toContain("1 question,");
	});

	it("lists the sessions with a link to their form", async () => {
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

	it("refreshes the list at a regular interval", async () => {
		api.list.mockResolvedValueOnce([]).mockResolvedValue([sessionSummary({ title: "Nouvelle" })]);
		const { fixture, el } = await render();
		expect(el.querySelectorAll(".session-list li")).toHaveLength(0);

		await vi.advanceTimersByTimeAsync(REFRESH_MS);
		fixture.detectChanges();
		expect(api.list).toHaveBeenCalledTimes(2);
		expect(el.querySelector(".session-list")?.textContent).toContain("Nouvelle");
	});

	it("keeps the list displayed when a refresh fails", async () => {
		api.list.mockResolvedValueOnce([sessionSummary({ title: "Stable" })]).mockRejectedValue(new Error("réseau"));
		const { fixture, el } = await render();
		await vi.advanceTimersByTimeAsync(REFRESH_MS);
		fixture.detectChanges();
		expect(el.querySelector(".session-list")?.textContent).toContain("Stable");
	});

	describe("history", () => {
		const closed = (id: string, overrides: Parameters<typeof sessionSummary>[0] = {}) =>
			sessionSummary({ id, title: `Passée ${id}`, status: "answered", answeredAt: 1000, ...overrides });
		const items = (el: HTMLElement) => Array.from(el.querySelectorAll(".history-list a"));

		it("does not show the section when there is no past session", async () => {
			api.list.mockResolvedValue([]);
			const { el } = await render();
			expect(el.querySelector(".history-title")).toBeNull();
		});

		it("lists past sessions with their status and a link to the detail", async () => {
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

		it("loads the next page on demand, without duplicates", async () => {
			api.list.mockResolvedValue([]);
			api.history
				.mockResolvedValueOnce({ items: [closed("a")], nextBefore: "1000:a" })
				.mockResolvedValueOnce({ items: [closed("a"), closed("b")], nextBefore: null });
			const { fixture, el } = await render();
			const more = el.querySelector<HTMLButtonElement>("button")!;
			expect(more.textContent).toContain("Charger plus");

			more.click();
			await vi.advanceTimersByTimeAsync(0);
			fixture.detectChanges();
			expect(api.history).toHaveBeenLastCalledWith("1000:a");
			expect(items(el).map((a) => a.getAttribute("href"))).toEqual(["/s/a", "/s/b"]);
			expect(el.querySelector("button")).toBeNull();
		});

		it("reloads the history only when the pending questions list changes", async () => {
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

		it("retries on the next tick when the first load fails", async () => {
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

	it("stops polling when the component is destroyed", async () => {
		api.list.mockResolvedValue([]);
		const { fixture } = await render();
		fixture.destroy();
		await vi.advanceTimersByTimeAsync(REFRESH_MS * 3);
		expect(api.list).toHaveBeenCalledTimes(1);
	});
});
