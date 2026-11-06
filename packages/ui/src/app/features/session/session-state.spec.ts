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
import { LiveService } from "../../core/live";
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

	describe("loading", () => {
		it("is loading before init", () => {
			expect(state.state()).toBe("loading");
		});

		it("switches to « ready » with empty answers for each question", async () => {
			await ready();
			expect(state.state()).toBe("ready");
			expect(state.answers()).toEqual({
				choix: { selected: [], text: "" },
				libre: { selected: [], text: "" },
			});
		});

		it("restores the saved draft", async () => {
			await ready(sessionView({ draft: { choix: { selected: ["b"], text: "" } } }));
			expect(state.answers()["choix"]).toEqual({ selected: ["b"], text: "" });
			expect(state.answers()["libre"]).toEqual({ selected: [], text: "" });
		});

		it.each(["answered", "declined"] as const)(
			"opens an already-%s session read-only, without polling",
			async (status) => {
				await ready(sessionView({ status }));
				expect(state.state()).toBe("closed");
				expect(state.session()?.status).toBe(status);
				await vi.advanceTimersByTimeAsync(POLL_MS * 2);
				expect(api.get).toHaveBeenCalledTimes(1);
			},
		);

		it("reports that a form is displayed while the session is editable, and no longer afterwards", async () => {
			const live = TestBed.inject(LiveService);
			await ready();
			TestBed.tick();
			expect(live.editing()).toBe(true);

			await state.decline("");
			TestBed.tick();
			expect(live.editing()).toBe(false);
		});

		it("no longer reports a form when the page is left", async () => {
			const live = TestBed.inject(LiveService);
			await ready();
			TestBed.tick();
			TestBed.resetTestingModule();
			expect(live.editing()).toBe(false);
		});

		it("leaves no polling behind when the page is left before loading ends", async () => {
			let resolve: (view: ReturnType<typeof sessionView>) => void = () => undefined;
			api.get.mockReturnValue(new Promise((done) => (resolve = done)));
			const loading = state.init("s1");
			TestBed.resetTestingModule();
			resolve(sessionView());
			await loading;
			await vi.advanceTimersByTimeAsync(POLL_MS * 3);
			expect(api.get).toHaveBeenCalledTimes(1);
		});

		it("switches to « missing » when the session is not found", async () => {
			api.get.mockRejectedValue(new HttpErrorResponse({ status: 404 }));
			await state.init("inconnue");
			expect(state.state()).toBe("missing");
		});
	});

	describe("refusal and draft", () => {
		it("sends only one refusal even if clicked twice", async () => {
			await ready();
			let finish: () => void = () => undefined;
			api.decline.mockReturnValue(new Promise((done) => (finish = () => done({}))));
			const first = state.decline("non");
			const second = state.decline("non");
			expect(state.declineSending()).toBe(true);
			finish();
			await Promise.all([first, second]);
			expect(api.decline).toHaveBeenCalledTimes(1);
			expect(state.declineSending()).toBe(false);
		});

		it("no longer shows « enregistré » when the draft save fails, and restores it afterwards", async () => {
			await ready();
			state.onAnswer("libre", { selected: [], text: "a" });
			await vi.advanceTimersByTimeAsync(DRAFT_DELAY_MS);
			expect(state.savedAt()).toBeInstanceOf(Date);

			api.saveDraft.mockRejectedValueOnce(new HttpErrorResponse({ status: 500 }));
			state.onAnswer("libre", { selected: [], text: "ab" });
			await vi.advanceTimersByTimeAsync(DRAFT_DELAY_MS);
			expect(state.draftFailed()).toBe(true);
			expect(state.savedAt()).toBeNull();

			state.onAnswer("libre", { selected: [], text: "abc" });
			await vi.advanceTimersByTimeAsync(DRAFT_DELAY_MS);
			expect(state.draftFailed()).toBe(false);
			expect(state.savedAt()).toBeInstanceOf(Date);
		});
	});

	describe("progress", () => {
		it("counts the answered questions and the missing required answers", async () => {
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

		it("answers answerFor even for a question without an answer", async () => {
			await ready();
			expect(state.answerFor(multiQuestion())).toEqual({ selected: [], text: "" });
		});
	});

	describe("draft", () => {
		it("saves the draft after a delay, grouping closely spaced edits", async () => {
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

		it("saves the pending input when the page is left", async () => {
			await ready();
			state.onAnswer("libre", { selected: [], text: "a" });
			TestBed.resetTestingModule();
			expect(api.saveDraft).toHaveBeenCalledExactlyOnceWith(
				"s1",
				expect.objectContaining({ libre: { selected: [], text: "a" } }),
			);
		});

		it("saves nothing when leaving the page if the draft is up to date", async () => {
			await ready();
			state.onAnswer("libre", { selected: [], text: "a" });
			await vi.advanceTimersByTimeAsync(DRAFT_DELAY_MS);
			api.saveDraft.mockClear();
			TestBed.resetTestingModule();
			expect(api.saveDraft).not.toHaveBeenCalled();
		});

		it("does not block the user when saving fails", async () => {
			await ready();
			api.saveDraft.mockRejectedValue(new Error("hors ligne"));
			state.onAnswer("libre", { selected: [], text: "a" });
			await vi.advanceTimersByTimeAsync(DRAFT_DELAY_MS);
			expect(state.savedAt()).toBeNull();
			expect(state.error()).toBeNull();
		});
	});

	describe("submission", () => {
		it("sends the answers then shows the confirmation", async () => {
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

		it("cancels the pending draft save", async () => {
			await ready();
			state.onAnswer("choix", { selected: ["a"], text: "" });
			await state.submit();
			await vi.advanceTimersByTimeAsync(DRAFT_DELAY_MS * 2);
			expect(api.saveDraft).not.toHaveBeenCalled();
		});

		it("shows the server's validation error details and stays on the form", async () => {
			await ready();
			api.submit.mockRejectedValue(
				new HttpErrorResponse({
					status: 422,
					error: { error: "Réponses invalides", details: ["Réponse manquante : Choix", "Option inconnue"] },
				}),
			);
			await state.submit();
			expect(state.error()).toBe("Réponses invalides (Réponse manquante : Choix ; Option inconnue)");
			expect(state.state()).toBe("ready");
			expect(state.sending()).toBe(false);
		});

		it("uses the server's message without details, or a default message", async () => {
			await ready();
			api.submit.mockRejectedValue(new HttpErrorResponse({ status: 409, error: { error: "Déjà clôturée" } }));
			await state.submit();
			expect(state.error()).toBe("Déjà clôturée");

			api.submit.mockRejectedValue(new Error("réseau"));
			await state.submit();
			expect(state.error()).toBe("L'envoi a échoué.");
		});

		it("clears the previous error on the new attempt", async () => {
			await ready();
			api.submit.mockRejectedValueOnce(new Error("réseau"));
			await state.submit();
			expect(state.error()).not.toBeNull();
			await state.submit();
			expect(state.error()).toBeNull();
		});
	});

	describe("refusal", () => {
		it("passes on the reason then shows the confirmation", async () => {
			await ready();
			await state.decline("pas le temps");
			expect(api.decline).toHaveBeenCalledWith("s1", "pas le temps");
			expect(state.state()).toBe("declined");
		});

		it("shows an error when the refusal fails", async () => {
			await ready();
			api.decline.mockRejectedValue(new Error("réseau"));
			await state.decline("");
			expect(state.error()).toBe("Le refus n'a pas pu être transmis.");
			expect(state.state()).toBe("ready");
		});
	});

	describe("modification of the questions by the agent", () => {
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

		it("touches nothing while the revision is unchanged", async () => {
			await ready();
			const before = state.session();
			await vi.advanceTimersByTimeAsync(POLL_MS);
			expect(api.get).toHaveBeenCalledTimes(2);
			expect(state.session()).toBe(before);
			expect(state.pendingUpdate()).toBeNull();
			expect(state.updated()).toBe(false);
		});

		it("offers the new version without applying it, and suspends submission", async () => {
			await ready();
			const before = state.session();
			state.onAnswer("libre", { selected: [], text: "ok" });
			state.onAnswer("choix", { selected: ["a"], text: "" });
			expect(state.canSubmit()).toBe(true);

			api.get.mockResolvedValue(edited());
			await vi.advanceTimersByTimeAsync(POLL_MS);

			expect(state.pendingUpdate()?.revision).toBe(1);
			expect(state.session()).toBe(before);
			expect(state.updated()).toBe(false);
			expect(state.canSubmit()).toBe(false);
		});

		it("keeps the same proposal while the revision has not changed, and takes the most recent one", async () => {
			await ready();
			api.get.mockResolvedValue(edited());
			await vi.advanceTimersByTimeAsync(POLL_MS);
			const first = state.pendingUpdate();
			await vi.advanceTimersByTimeAsync(POLL_MS);
			expect(state.pendingUpdate()).toBe(first);

			api.get.mockResolvedValue(edited({ revision: 2 }));
			await vi.advanceTimersByTimeAsync(POLL_MS);
			expect(state.pendingUpdate()?.revision).toBe(2);
		});

		it("applies the new version on request: questions up to date, submission restored", async () => {
			await ready();
			state.onAnswer("libre", { selected: [], text: "ok" });
			state.onAnswer("choix", { selected: ["b"], text: "" });
			api.get.mockResolvedValue(edited());
			await vi.advanceTimersByTimeAsync(POLL_MS);

			state.applyUpdate();
			expect(state.session()?.revision).toBe(1);
			expect(state.pendingUpdate()).toBeNull();
			expect(state.updated()).toBe(true);
			expect(state.canSubmit()).toBe(true);
		});

		it("does nothing when there is no proposal to apply", async () => {
			await ready();
			const before = state.session();
			state.applyUpdate();
			expect(state.session()).toBe(before);
			expect(state.updated()).toBe(false);
		});

		it("keeps the typed answers when the new version is displayed", async () => {
			await ready();
			state.onAnswer("libre", { selected: [], text: "en cours de saisie" });
			state.onAnswer("choix", { selected: ["b"], text: "" });

			api.get.mockResolvedValue(edited());
			await vi.advanceTimersByTimeAsync(POLL_MS);
			state.applyUpdate();

			expect(state.session()?.revision).toBe(1);
			expect(state.session()?.questions[0]?.options?.map((o) => o.id)).toEqual(["b", "c"]);
			expect(state.updated()).toBe(true);
			expect(state.answers()["libre"]?.text).toBe("en cours de saisie");
			expect(state.answers()["choix"]?.selected).toEqual(["b"]);
		});

		it("removes from the answers the options that no longer exist", async () => {
			await ready();
			state.onAnswer("choix", { selected: ["a"], text: "" });
			api.get.mockResolvedValue(edited());
			await vi.advanceTimersByTimeAsync(POLL_MS);
			state.applyUpdate();
			expect(state.answers()["choix"]?.selected).toEqual([]);
		});

		it("also removes the notes of the options that no longer exist", async () => {
			await ready();
			state.onAnswer("choix", { selected: ["a", "b"], text: "", notes: { a: "perdue", b: "gardée" } });
			api.get.mockResolvedValue(edited());
			await vi.advanceTimersByTimeAsync(POLL_MS);
			state.applyUpdate();
			expect(state.answers()["choix"]?.notes).toEqual({ b: "gardée" });
		});

		it("adds an empty answer for a new question and drops those removed", async () => {
			await ready();
			api.get.mockResolvedValue(edited({ questions: [textQuestion(), multiQuestion()] }));
			await vi.advanceTimersByTimeAsync(POLL_MS);
			state.applyUpdate();
			expect(Object.keys(state.answers()).sort()).toEqual(["libre", "multi"]);
			expect(state.answers()["multi"]).toEqual({ selected: [], text: "" });
		});

		it("takes the server's draft for a question without local input", async () => {
			await ready();
			api.get.mockResolvedValue(
				edited({
					questions: [textQuestion(), multiQuestion()],
					draft: { multi: { selected: ["x"], text: "" } },
				}),
			);
			await vi.advanceTimersByTimeAsync(POLL_MS);
			state.applyUpdate();
			expect(state.answers()["multi"]?.selected).toEqual(["x"]);
		});

		it("switches to the final state if the session is closed elsewhere", async () => {
			await ready();
			api.get.mockResolvedValue(sessionView({ status: "answered" }));
			await vi.advanceTimersByTimeAsync(POLL_MS);
			expect(state.state()).toBe("answered");
		});

		it("keeps polling after a network failure", async () => {
			await ready();
			api.get.mockRejectedValueOnce(new Error("réseau")).mockResolvedValue(edited());
			await vi.advanceTimersByTimeAsync(POLL_MS);
			expect(state.pendingUpdate()).toBeNull();
			await vi.advanceTimersByTimeAsync(POLL_MS);
			expect(state.pendingUpdate()?.revision).toBe(1);
		});

		it("does not poll during a submission", async () => {
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

		it("does not cancel the polling of a missing session: it does not start", async () => {
			api.get.mockRejectedValue(new HttpErrorResponse({ status: 404 }));
			await state.init("inconnue");
			await vi.advanceTimersByTimeAsync(POLL_MS * 3);
			expect(api.get).toHaveBeenCalledTimes(1);
		});
	});
});
