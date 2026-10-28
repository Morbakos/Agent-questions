import type { Question, SessionSummary, SessionView } from "@agent-questions/shared";
import { ApiService } from "../app/core/api";

export const singleQuestion = (overrides: Partial<Question> = {}): Question => ({
	id: "choix",
	header: "Choix",
	prompt: "Lequel **choisir** ?",
	type: "single",
	options: [
		{ id: "a", label: "Option A", description: "La première", recommended: true },
		{ id: "b", label: "Option B" },
	],
	...overrides,
});

export const multiQuestion = (overrides: Partial<Question> = {}): Question => ({
	id: "multi",
	prompt: "Lesquels ?",
	type: "multi",
	options: [
		{ id: "x", label: "X" },
		{ id: "y", label: "Y" },
	],
	...overrides,
});

export const textQuestion = (overrides: Partial<Question> = {}): Question => ({
	id: "libre",
	header: "Libre",
	prompt: "Pourquoi ?",
	type: "text",
	...overrides,
});

export const sessionView = (overrides: Partial<SessionView> = {}): SessionView => ({
	id: "s1",
	title: "Ma session",
	status: "pending",
	revision: 0,
	questions: [singleQuestion(), textQuestion()],
	draft: {},
	answers: null,
	declineReason: null,
	...overrides,
});

export const sessionSummary = (overrides: Partial<SessionSummary> = {}): SessionSummary => ({
	id: "s1",
	title: "Ma session",
	createdAt: new Date(2026, 9, 28, 14, 30).getTime(),
	questionCount: 2,
	...overrides,
});

/** Double de `ApiService` : chaque méthode est un `vi.fn()` réglable par test. */
export function apiMock() {
	return {
		list: vi.fn<ApiService["list"]>(),
		get: vi.fn<ApiService["get"]>(),
		saveDraft: vi.fn<ApiService["saveDraft"]>().mockResolvedValue({}),
		submit: vi.fn<ApiService["submit"]>().mockResolvedValue({}),
		decline: vi.fn<ApiService["decline"]>().mockResolvedValue({}),
	};
}

export type ApiMock = ReturnType<typeof apiMock>;
