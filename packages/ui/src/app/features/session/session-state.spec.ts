import { HttpErrorResponse } from "@angular/common/http";
import { TestBed } from "@angular/core/testing";
import {
	type ApiMock,
	apiMock,
	multiQuestion,
	sessionView,
	singleQuestion,
	textQuestion,
} from "../../../testing/fixtures";
import { ApiService } from "../../core/api";
import { DRAFT_DELAY_MS, POLL_MS, SessionState } from "./session-state";

describe("SessionState", () => {
	let api: ApiMock;
	let state: SessionState;

	beforeEach(() => {
		vi.useFakeTimers();
		api = apiMock();
		TestBed.configureTestingModule({ providers: [SessionState, { provide: ApiService, useValue: api }] });
		state = TestBed.inject(SessionState);
	});

	afterEach(() => vi.useRealTimers());

	const ready = async (view = sessionView()) => {
		api.get.mockResolvedValue(view);
		await state.init(view.id);
	};

	describe("chargement", () => {
		it("est en chargement avant init", () => {
			expect(state.state()).toBe("loading");
		});

		it("passe à « ready » avec des réponses vides pour chaque question", async () => {
			await ready();
			expect(state.state()).toBe("ready");
			expect(state.answers()).toEqual({
				choix: { selected: [], text: "" },
				libre: { selected: [], text: "" },
			});
		});

		it("restaure le brouillon enregistré", async () => {
			await ready(sessionView({ draft: { choix: { selected: ["b"], text: "" } } }));
			expect(state.answers()["choix"]).toEqual({ selected: ["b"], text: "" });
			expect(state.answers()["libre"]).toEqual({ selected: [], text: "" });
		});

		it.each(["answered", "declined"] as const)(
			"ouvre une session déjà %s en lecture seule, sans sondage",
			async (status) => {
				await ready(sessionView({ status }));
				expect(state.state()).toBe("closed");
				expect(state.session()?.status).toBe(status);
				await vi.advanceTimersByTimeAsync(POLL_MS * 2);
				expect(api.get).toHaveBeenCalledTimes(1);
			},
		);

		it("passe à « missing » quand la session est introuvable", async () => {
			api.get.mockRejectedValue(new HttpErrorResponse({ status: 404 }));
			await state.init("inconnue");
			expect(state.state()).toBe("missing");
		});
	});

	describe("progression", () => {
		it("compte les questions répondues et les réponses obligatoires manquantes", async () => {
			await ready(
				sessionView({ questions: [singleQuestion(), textQuestion(), multiQuestion({ required: false })] }),
			);
			expect(state.doneCount()).toBe(0);
			expect(state.missing()).toBe(2);
			expect(state.canSubmit()).toBe(false);

			state.onAnswer("choix", { selected: ["a"], text: "" });
			state.onAnswer("libre", { selected: [], text: "parce que" });
			expect(state.doneCount()).toBe(2);
			expect(state.missing()).toBe(0);
			expect(state.canSubmit()).toBe(true);
		});

		it("répond à answerFor même pour une question sans réponse", async () => {
			await ready();
			expect(state.answerFor(multiQuestion())).toEqual({ selected: [], text: "" });
		});
	});

	describe("brouillon", () => {
		it("enregistre le brouillon après un délai, en regroupant les saisies rapprochées", async () => {
			await ready();
			state.onAnswer("libre", { selected: [], text: "a" });
			await vi.advanceTimersByTimeAsync(DRAFT_DELAY_MS - 1);
			state.onAnswer("libre", { selected: [], text: "ab" });
			await vi.advanceTimersByTimeAsync(DRAFT_DELAY_MS - 1);
			expect(api.saveDraft).not.toHaveBeenCalled();

			await vi.advanceTimersByTimeAsync(1);
			expect(api.saveDraft).toHaveBeenCalledTimes(1);
			expect(api.saveDraft).toHaveBeenCalledWith(
				"s1",
				expect.objectContaining({ libre: { selected: [], text: "ab" } }),
			);
			expect(state.savedAt()).toBeInstanceOf(Date);
		});

		it("ne bloque pas l'utilisateur quand l'enregistrement échoue", async () => {
			await ready();
			api.saveDraft.mockRejectedValue(new Error("hors ligne"));
			state.onAnswer("libre", { selected: [], text: "a" });
			await vi.advanceTimersByTimeAsync(DRAFT_DELAY_MS);
			expect(state.savedAt()).toBeNull();
			expect(state.error()).toBeNull();
		});
	});

	describe("envoi", () => {
		it("envoie les réponses puis affiche la confirmation", async () => {
			await ready();
			state.onAnswer("choix", { selected: ["a"], text: "" });
			await state.submit();
			expect(api.submit).toHaveBeenCalledWith(
				"s1",
				expect.objectContaining({ choix: { selected: ["a"], text: "" } }),
			);
			expect(state.state()).toBe("answered");
			expect(state.sending()).toBe(false);
		});

		it("annule l'enregistrement de brouillon en attente", async () => {
			await ready();
			state.onAnswer("choix", { selected: ["a"], text: "" });
			await state.submit();
			await vi.advanceTimersByTimeAsync(DRAFT_DELAY_MS * 2);
			expect(api.saveDraft).not.toHaveBeenCalled();
		});

		it("affiche le détail des erreurs de validation du serveur et reste sur le formulaire", async () => {
			await ready();
			api.submit.mockRejectedValue(
				new HttpErrorResponse({
					status: 422,
					error: { error: "Réponses invalides", details: ["Réponse manquante : Choix", "Option inconnue"] },
				}),
			);
			await state.submit();
			expect(state.error()).toBe("Réponses invalides : Réponse manquante : Choix ; Option inconnue");
			expect(state.state()).toBe("ready");
			expect(state.sending()).toBe(false);
		});

		it("utilise le message du serveur sans détails, ou un message par défaut", async () => {
			await ready();
			api.submit.mockRejectedValue(new HttpErrorResponse({ status: 409, error: { error: "Déjà clôturée" } }));
			await state.submit();
			expect(state.error()).toBe("Déjà clôturée");

			api.submit.mockRejectedValue(new Error("réseau"));
			await state.submit();
			expect(state.error()).toBe("L'envoi a échoué.");
		});

		it("efface l'erreur précédente au nouvel essai", async () => {
			await ready();
			api.submit.mockRejectedValueOnce(new Error("réseau"));
			await state.submit();
			expect(state.error()).not.toBeNull();
			await state.submit();
			expect(state.error()).toBeNull();
		});
	});

	describe("refus", () => {
		it("transmet le motif puis affiche la confirmation", async () => {
			await ready();
			await state.decline("pas le temps");
			expect(api.decline).toHaveBeenCalledWith("s1", "pas le temps");
			expect(state.state()).toBe("declined");
		});

		it("affiche une erreur quand le refus échoue", async () => {
			await ready();
			api.decline.mockRejectedValue(new Error("réseau"));
			await state.decline("");
			expect(state.error()).toBe("Le refus n'a pas pu être transmis.");
			expect(state.state()).toBe("ready");
		});
	});

	describe("modification des questions par l'agent", () => {
		const edited = (overrides = {}) =>
			sessionView({
				revision: 1,
				questions: [
					singleQuestion({
						options: [
							{ id: "b", label: "Option B" },
							{ id: "c", label: "Option C", recommended: true },
						],
					}),
					textQuestion(),
				],
				...overrides,
			});

		it("ne touche à rien tant que la révision est inchangée", async () => {
			await ready();
			const before = state.session();
			await vi.advanceTimersByTimeAsync(POLL_MS);
			expect(api.get).toHaveBeenCalledTimes(2);
			expect(state.session()).toBe(before);
			expect(state.updated()).toBe(false);
		});

		it("met à jour les questions, prévient l'utilisateur et conserve ses réponses", async () => {
			await ready();
			state.onAnswer("libre", { selected: [], text: "en cours de saisie" });
			state.onAnswer("choix", { selected: ["b"], text: "" });

			api.get.mockResolvedValue(edited());
			await vi.advanceTimersByTimeAsync(POLL_MS);

			expect(state.session()?.revision).toBe(1);
			expect(state.session()?.questions[0]?.options?.map((o) => o.id)).toEqual(["b", "c"]);
			expect(state.updated()).toBe(true);
			expect(state.answers()["libre"]?.text).toBe("en cours de saisie");
			expect(state.answers()["choix"]?.selected).toEqual(["b"]);
		});

		it("retire des réponses les options qui n'existent plus", async () => {
			await ready();
			state.onAnswer("choix", { selected: ["a"], text: "" });
			api.get.mockResolvedValue(edited());
			await vi.advanceTimersByTimeAsync(POLL_MS);
			expect(state.answers()["choix"]?.selected).toEqual([]);
		});

		it("ajoute une réponse vide pour une nouvelle question et abandonne celles supprimées", async () => {
			await ready();
			api.get.mockResolvedValue(edited({ questions: [textQuestion(), multiQuestion()] }));
			await vi.advanceTimersByTimeAsync(POLL_MS);
			expect(Object.keys(state.answers()).sort()).toEqual(["libre", "multi"]);
			expect(state.answers()["multi"]).toEqual({ selected: [], text: "" });
		});

		it("reprend le brouillon du serveur pour une question sans saisie locale", async () => {
			await ready();
			api.get.mockResolvedValue(
				edited({
					questions: [textQuestion(), multiQuestion()],
					draft: { multi: { selected: ["x"], text: "" } },
				}),
			);
			await vi.advanceTimersByTimeAsync(POLL_MS);
			expect(state.answers()["multi"]?.selected).toEqual(["x"]);
		});

		it("bascule sur l'état final si la session est clôturée ailleurs", async () => {
			await ready();
			api.get.mockResolvedValue(sessionView({ status: "answered" }));
			await vi.advanceTimersByTimeAsync(POLL_MS);
			expect(state.state()).toBe("answered");
		});

		it("continue de sonder après un échec réseau", async () => {
			await ready();
			api.get.mockRejectedValueOnce(new Error("réseau")).mockResolvedValue(edited());
			await vi.advanceTimersByTimeAsync(POLL_MS);
			expect(state.updated()).toBe(false);
			await vi.advanceTimersByTimeAsync(POLL_MS);
			expect(state.updated()).toBe(true);
		});

		it("ne sonde pas pendant un envoi", async () => {
			await ready();
			let release!: () => void;
			api.submit.mockReturnValue(new Promise((resolve) => (release = () => resolve({}))));
			const pending = state.submit();
			const calls = api.get.mock.calls.length;
			await vi.advanceTimersByTimeAsync(POLL_MS);
			expect(api.get.mock.calls.length).toBe(calls);
			release();
			await pending;
		});

		it("n'annule pas le sondage d'une session introuvable : il ne démarre pas", async () => {
			api.get.mockRejectedValue(new HttpErrorResponse({ status: 404 }));
			await state.init("inconnue");
			await vi.advanceTimersByTimeAsync(POLL_MS * 3);
			expect(api.get).toHaveBeenCalledTimes(1);
		});
	});
});
