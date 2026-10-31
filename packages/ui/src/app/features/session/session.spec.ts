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

	it("affiche « Chargement » puis le formulaire", async () => {
		api.get.mockResolvedValue(sessionView());
		const fixture = TestBed.createComponent(SessionComponent);
		expect((fixture.nativeElement as HTMLElement).textContent).toBe("");
		await vi.advanceTimersByTimeAsync(0);
		await fixture.whenStable();
		expect((fixture.nativeElement as HTMLElement).querySelector("h1")?.textContent).toBe("Ma session");
	});

	it("affiche le plan, les questions et le compteur de progression", async () => {
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

	it("affiche une page dédiée quand la session est introuvable", async () => {
		api.get.mockRejectedValue(new Error("404"));
		const { el } = await render();
		expect(el.querySelector("h1")?.textContent).toBe("Session introuvable");
		expect(el.querySelector("a")?.getAttribute("href")).toBe("/");
	});

	it("affiche en lecture seule les questions et les réponses d'une session répondue", async () => {
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

	it("signale les questions sans réponse", async () => {
		api.get.mockResolvedValue(sessionView({ status: "answered", answers: {} }));
		const { el } = await render();
		expect(el.querySelectorAll(".past-answer")[0]?.textContent).toContain("Sans réponse.");
	});

	it("affiche le motif du refus d'une session refusée, sans réponses", async () => {
		api.get.mockResolvedValue(sessionView({ status: "declined", declineReason: "hors sujet" }));
		const { el } = await render();
		expect(el.querySelector(".notice")?.textContent).toContain("hors sujet");
		expect(el.querySelector(".past-answer")).toBeNull();
		expect(el.querySelectorAll(".past")).toHaveLength(2);
	});

	it("garde le bouton d'envoi désactivé tant que les réponses obligatoires manquent", async () => {
		api.get.mockResolvedValue(sessionView());
		const { el } = await render();
		expect(button(el, "Envoyer")?.disabled).toBe(true);
		expect(el.textContent).toContain("2 réponse(s) obligatoire(s) manquante(s)");
	});

	it("envoie les réponses saisies et affiche la confirmation", async () => {
		api.get.mockResolvedValue(sessionView());
		const { el, settle } = await render();

		el.querySelector<HTMLInputElement>("input[type=radio]")!.click();
		const area = el.querySelector<HTMLTextAreaElement>("textarea")!;
		area.value = "parce que";
		area.dispatchEvent(new Event("input"));
		await settle();

		const send = button(el, "Envoyer")!;
		expect(send.disabled).toBe(false);
		send.click();
		await settle();

		expect(api.submit).toHaveBeenCalledWith("s1", {
			choix: { selected: ["a"], text: "" },
			libre: { selected: [], text: "parce que" },
		});
		expect(el.querySelector("h1")?.textContent).toBe("Réponses envoyées");
	});

	it("affiche l'erreur du serveur en cas d'échec de l'envoi", async () => {
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

	describe("refus", () => {
		it("demande un motif avant de transmettre le refus", async () => {
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

		it("permet d'annuler le refus", async () => {
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

	it("propose d'afficher les questions modifiées par l'agent, sans les imposer", async () => {
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

	it("affiche les questions modifiées quand l'utilisateur le demande, puis rétablit l'envoi", async () => {
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

	it("fait défiler vers la question depuis le plan", async () => {
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
