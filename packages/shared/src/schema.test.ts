import { describe, expect, it } from "vitest";
import { isAnswered, validateAnswers } from "./answers.js";
import { type Question, QuestionSchema } from "./schema.js";

const singleQuestion = (overrides: Partial<Question> = {}): Question => ({
	id: "choix",
	prompt: "Lequel ?",
	type: "single",
	options: [
		{ id: "a", label: "A", recommended: true },
		{ id: "b", label: "B" },
	],
	...overrides,
});

const textQuestion = (overrides: Partial<Question> = {}): Question => ({
	id: "libre",
	prompt: "Pourquoi ?",
	type: "text",
	...overrides,
});

describe("QuestionSchema", () => {
	it("accepts a single-choice question with a recommended option", () => {
		const parsed = QuestionSchema.parse(singleQuestion());
		expect(parsed.options?.[0]?.recommended).toBe(true);
	});

	it("accepts a free-text question without options", () => {
		expect(QuestionSchema.safeParse(textQuestion()).success).toBe(true);
	});

	it("rejects a choice with fewer than two options", () => {
		const q = singleQuestion({ options: [{ id: "a", label: "A" }] });
		expect(QuestionSchema.safeParse(q).success).toBe(false);
	});

	it("rejects duplicate option ids", () => {
		const q = singleQuestion({
			options: [
				{ id: "a", label: "A" },
				{ id: "a", label: "A bis" },
			],
		});
		expect(QuestionSchema.safeParse(q).success).toBe(false);
	});

	it("rejects an id that is not snake_case", () => {
		expect(QuestionSchema.safeParse(singleQuestion({ id: "Mon Id" })).success).toBe(false);
	});
});

describe("isAnswered", () => {
	it("treats an empty free-text answer as unanswered", () => {
		expect(isAnswered(textQuestion(), { selected: [], text: "   " })).toBe(false);
		expect(isAnswered(textQuestion(), { selected: [], text: "ok" })).toBe(true);
	});

	it("accepts the « Autre » field by default, unless allow_other: false", () => {
		const answer = { selected: [], text: "autre chose" };
		expect(isAnswered(singleQuestion(), answer)).toBe(true);
		expect(isAnswered(singleQuestion({ allow_other: true }), answer)).toBe(true);
		expect(isAnswered(singleQuestion({ allow_other: false }), answer)).toBe(false);
	});

	it("treats a missing answer as unanswered", () => {
		expect(isAnswered(singleQuestion(), undefined)).toBe(false);
	});
});

describe("validateAnswers", () => {
	it("returns no error for valid answers", () => {
		const errors = validateAnswers([singleQuestion()], { choix: { selected: ["a"], text: "" } });
		expect(errors).toEqual([]);
	});

	it("reports a missing required answer", () => {
		expect(validateAnswers([singleQuestion()], {})).toHaveLength(1);
	});

	it("tolerates a missing answer to an optional question", () => {
		expect(validateAnswers([singleQuestion({ required: false })], {})).toEqual([]);
	});

	it("reports an unknown option", () => {
		const errors = validateAnswers([singleQuestion()], { choix: { selected: ["zzz"], text: "" } });
		expect(errors.join(" ")).toContain("zzz");
	});

	it("rejects several options on a single-choice question", () => {
		const errors = validateAnswers([singleQuestion()], { choix: { selected: ["a", "b"], text: "" } });
		expect(errors.length).toBeGreaterThan(0);
	});

	it("accepts a note on a selected option", () => {
		const answers = { choix: { selected: ["a"], text: "", notes: { a: "précision" } } };
		expect(validateAnswers([singleQuestion()], answers)).toEqual([]);
	});

	it("rejects a note on an option that is not selected", () => {
		const answers = { choix: { selected: ["a"], text: "", notes: { b: "précision" } } };
		expect(validateAnswers([singleQuestion()], answers).join(" ")).toContain("b");
	});

	it("rejects a note when allow_notes is false", () => {
		const answers = { choix: { selected: ["a"], text: "", notes: { a: "précision" } } };
		expect(validateAnswers([singleQuestion({ allow_notes: false })], answers)).toHaveLength(1);
	});

	it("does not count a note as an answer", () => {
		expect(isAnswered(singleQuestion(), { selected: [], text: "", notes: { a: "x" } })).toBe(false);
	});

	it("reports an answer to an unknown question", () => {
		const errors = validateAnswers([textQuestion()], {
			libre: { selected: [], text: "x" },
			fantome: { selected: [], text: "x" },
		});
		expect(errors.join(" ")).toContain("fantome");
	});
});
