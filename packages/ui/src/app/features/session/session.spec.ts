import { TestBed } from "@angular/core/testing";
import { ActivatedRoute, convertToParamMap, provideRouter } from "@angular/router";
import { type ApiMock, apiMock, sessionView } from "../../../testing/fixtures";
import { ApiService } from "../../core/api";
import { SessionComponent } from "./session";
import { POLL_MS } from "./session-state";

describe("SessionComponent", () => {
	let api: ApiMock;

	beforeEach(() => {
		vi.useFakeTimers();
		api = apiMock();
		TestBed.configureTestingModule({
			providers: [
				provideRouter([]),
				{ provide: ApiService, useValue: api },
				{ provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id: "s1" }) } } },
			],
		});
	});

	afterEach(() => vi.useRealTimers());

	async function render() {
		const fixture = TestBed.createComponent(SessionComponent);
		await vi.advanceTimersByTimeAsync(0);
		await fixture.whenStable();
		const el = fixture.nativeElement as HTMLElement;
		const settle = async (ms = 0) => {
			await vi.advanceTimersByTimeAsync(ms);
			fixture.detectChanges();
		};
		return { fixture, el, settle };
	}

	const button = (el: HTMLElement, text: string) =>
		Array.from(el.querySelectorAll("button")).find((b) => b.textContent?.includes(text));

	it("shows « Chargement » then the form", async () => {
		api.get.mockResolvedValue(sessionView());
		const fixture = TestBed.createComponent(SessionComponent);
		expect((fixture.nativeElement as HTMLElement).textContent).toBe("");
		await vi.advanceTimersByTimeAsync(0);
		await fixture.whenStable();
		expect((fixture.nativeElement as HTMLElement).querySelector("h1")?.textContent).toBe("Ma session");
	});

	it("shows the outline, the questions and the progress counter", async () => {
		api.get.mockResolvedValue(sessionView());
		const { el } = await render();
		expect(Array.from(el.querySelectorAll(".outline-link")).map((b) => b.textContent?.trim())).toEqual([
			"Choix",
			"Libre",
		]);
		expect(el.querySelectorAll("app-question")).toHaveLength(2);
		expect(el.querySelector(".outline")?.textContent).toContain("0 sur 2 répondues");
		expect(el.querySelector(".badge")?.textContent).toBe("Recommandé");
	});

	it("shows a dedicated page when the session is not found", async () => {
		api.get.mockRejectedValue(new Error("404"));
		const { el } = await render();
		expect(el.querySelector("h1")?.textContent).toBe("Session introuvable");
		expect(el.querySelector("a")?.getAttribute("href")).toBe("/");
	});

	it("shows the questions and answers of an answered session read-only", async () => {
		api.get.mockResolvedValue(
			sessionView({
				status: "answered",
				answers: { choix: { selected: ["b"], text: "" }, libre: { selected: [], text: "parce que" } },
			}),
		);
		const { el } = await render();
		expect(el.querySelector("h1")?.textContent).toBe("Ma session");
		expect(el.querySelectorAll(".past")).toHaveLength(2);
		const answers = Array.from(el.querySelectorAll(".past-answer")).map((a) => a.textContent?.trim());
		expect(answers).toEqual(["Option B", "parce que"]);
		expect(el.querySelector("textarea, input, button")).toBeNull();
		expect(el.querySelector("a")?.getAttribute("href")).toBe("/");
	});

	it("flags the unanswered questions", async () => {
		api.get.mockResolvedValue(sessionView({ status: "answered", answers: {} }));
		const { el } = await render();
		expect(el.querySelectorAll(".past-answer")[0]?.textContent).toContain("Sans réponse.");
	});

	it("shows the reason for the refusal of a declined session, without answers", async () => {
		api.get.mockResolvedValue(sessionView({ status: "declined", declineReason: "hors sujet" }));
		const { el } = await render();
		expect(el.querySelector(".notice")?.textContent).toContain("hors sujet");
		expect(el.querySelector(".past-answer")).toBeNull();
		expect(el.querySelectorAll(".past")).toHaveLength(2);
	});

	it("keeps the submit button disabled while required answers are missing", async () => {
		api.get.mockResolvedValue(sessionView());
		const { el } = await render();
		expect(button(el, "Envoyer")?.disabled).toBe(true);
		expect(el.textContent).toContain("2 réponse(s) obligatoire(s) manquante(s)");
	});

	it("sends the typed answers and shows the confirmation", async () => {
		api.get.mockResolvedValue(sessionView());
		const { el, settle } = await render();

		el.querySelector<HTMLInputElement>("input[type=radio]")!.click();
		// The choice question also offers an "Autre" field (by default): the free-text question is the last one.
		const area = [...el.querySelectorAll<HTMLTextAreaElement>("textarea")].at(-1)!;
		area.value = "parce que";
		area.dispatchEvent(new Event("input"));
		await settle();

		const send = button(el, "Envoyer")!;
		expect(send.disabled).toBe(false);
		send.click();
		await settle();

		expect(api.submit).toHaveBeenCalledWith("s1", {
			choix: { selected: ["a"], text: "", notes: {} },
			libre: { selected: [], text: "parce que" },
		});
		expect(el.querySelector("h1")?.textContent).toBe("Réponses envoyées");
	});

	it("shows the server error when submission fails", async () => {
		api.get.mockResolvedValue(sessionView({ questions: [sessionView().questions[1]!] }));
		api.submit.mockRejectedValue(new Error("réseau"));
		const { el, settle } = await render();
		const area = el.querySelector<HTMLTextAreaElement>("textarea")!;
		area.value = "x";
		area.dispatchEvent(new Event("input"));
		await settle();
		button(el, "Envoyer")!.click();
		await settle();
		expect(el.querySelector("[role=alert]")?.textContent).toContain("L'envoi a échoué.");
	});

	describe("refusal", () => {
		it("asks for a reason before sending the refusal", async () => {
			api.get.mockResolvedValue(sessionView());
			const { el, settle } = await render();
			expect(el.querySelector("#reason")).toBeNull();

			button(el, "Ne pas répondre")!.click();
			await settle();
			const reason = el.querySelector<HTMLTextAreaElement>("#reason")!;
			reason.value = "hors sujet";
			reason.dispatchEvent(new Event("input"));
			await settle();

			button(el, "Confirmer le refus")!.click();
			await settle();
			expect(api.decline).toHaveBeenCalledWith("s1", "hors sujet");
			expect(el.querySelector("h1")?.textContent).toBe("Refus transmis");
		});

		it("allows cancelling the refusal", async () => {
			api.get.mockResolvedValue(sessionView());
			const { el, settle } = await render();
			button(el, "Ne pas répondre")!.click();
			await settle();
			button(el, "Annuler")!.click();
			await settle();
			expect(el.querySelector("#reason")).toBeNull();
			expect(button(el, "Ne pas répondre")).toBeDefined();
		});
	});

	it("offers to display the questions modified by the agent, without imposing them", async () => {
		api.get.mockResolvedValue(sessionView());
		const { el, settle } = await render();
		expect(el.querySelector(".notice")).toBeNull();

		api.get.mockResolvedValue(sessionView({ revision: 1, title: "Titre modifié" }));
		await settle(POLL_MS);
		expect(el.querySelector(".notice")?.textContent).toContain("L'agent a modifié les questions");
		expect(el.querySelector("h1")?.textContent).toBe("Ma session");
		expect(button(el, "Envoyer")?.disabled).toBe(true);
		expect(el.textContent).toContain("Envoi suspendu");
	});

	it("displays the modified questions when the user asks, then restores submission", async () => {
		api.get.mockResolvedValue(sessionView({ questions: [sessionView().questions[1]!] }));
		const { el, settle } = await render();
		const area = el.querySelector<HTMLTextAreaElement>("textarea")!;
		area.value = "ok";
		area.dispatchEvent(new Event("input"));
		await settle();
		expect(button(el, "Envoyer")?.disabled).toBe(false);

		api.get.mockResolvedValue(
			sessionView({ revision: 1, title: "Titre modifié", questions: [sessionView().questions[1]!] }),
		);
		await settle(POLL_MS);
		expect(button(el, "Envoyer")?.disabled).toBe(true);

		button(el, "Afficher les nouvelles questions")!.click();
		await settle();
		expect(el.querySelector("h1")?.textContent).toBe("Titre modifié");
		expect(el.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("ok");
		expect(el.querySelector(".notice")?.textContent).toContain("conservées");
		expect(button(el, "Envoyer")?.disabled).toBe(false);
		expect(button(el, "Afficher les nouvelles questions")).toBeUndefined();
	});

	it("scrolls to the question from the outline", async () => {
		api.get.mockResolvedValue(sessionView());
		const { el, settle } = await render();
		const scrollIntoView = vi.fn();
		Element.prototype.scrollIntoView = scrollIntoView;
		vi.stubGlobal("matchMedia", () => ({ matches: false }));

		(el.querySelectorAll(".outline-link")[1] as HTMLButtonElement).click();
		await settle();
		expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
		vi.unstubAllGlobals();
	});
});
