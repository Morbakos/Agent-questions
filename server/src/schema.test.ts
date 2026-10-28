import { describe, expect, it } from "vitest";
import { QuestionSchema, isAnswered, validateAnswers } from "./schema.js";
import { singleQuestion, textQuestion } from "./test-helpers.js";

describe("QuestionSchema", () => {
	it("accepte une question à choix unique avec une option recommandée", () => {
		const parsed = QuestionSchema.parse(singleQuestion());
		expect(parsed.options?.[0]?.recommended).toBe(true);
	});

	it("accepte une question libre sans options", () => {
		expect(QuestionSchema.safeParse(textQuestion()).success).toBe(true);
	});

	it("refuse un choix avec moins de deux options", () => {
		const q = singleQuestion({ options: [{ id: "a", label: "A" }] });
		expect(QuestionSchema.safeParse(q).success).toBe(false);
	});

	it("refuse des identifiants d'option en double", () => {
		const q = singleQuestion({
			options: [
				{ id: "a", label: "A" },
				{ id: "a", label: "A bis" },
			],
		});
		expect(QuestionSchema.safeParse(q).success).toBe(false);
	});

	it("refuse un identifiant qui n'est pas en snake_case", () => {
		expect(QuestionSchema.safeParse(singleQuestion({ id: "Mon Id" })).success).toBe(false);
	});
});

describe("isAnswered", () => {
	it("considère une réponse libre vide comme non répondue", () => {
		expect(isAnswered(textQuestion(), { selected: [], text: "   " })).toBe(false);
		expect(isAnswered(textQuestion(), { selected: [], text: "ok" })).toBe(true);
	});

	it("accepte le champ « Autre » seulement si allow_other est actif", () => {
		const answer = { selected: [], text: "autre chose" };
		expect(isAnswered(singleQuestion(), answer)).toBe(false);
		expect(isAnswered(singleQuestion({ allow_other: true }), answer)).toBe(true);
	});

	it("traite l'absence de réponse comme non répondue", () => {
		expect(isAnswered(singleQuestion(), undefined)).toBe(false);
	});
});

describe("validateAnswers", () => {
	it("ne renvoie aucune erreur pour des réponses valides", () => {
		const errors = validateAnswers([singleQuestion()], { choix: { selected: ["a"], text: "" } });
		expect(errors).toEqual([]);
	});

	it("signale une réponse obligatoire manquante", () => {
		expect(validateAnswers([singleQuestion()], {})).toHaveLength(1);
	});

	it("tolère l'absence de réponse à une question facultative", () => {
		expect(validateAnswers([singleQuestion({ required: false })], {})).toEqual([]);
	});

	it("signale une option inconnue", () => {
		const errors = validateAnswers([singleQuestion()], { choix: { selected: ["zzz"], text: "" } });
		expect(errors.join(" ")).toContain("zzz");
	});

	it("refuse plusieurs options en choix unique", () => {
		const errors = validateAnswers([singleQuestion()], { choix: { selected: ["a", "b"], text: "" } });
		expect(errors.length).toBeGreaterThan(0);
	});

	it("signale une réponse à une question inconnue", () => {
		const errors = validateAnswers([textQuestion()], {
			libre: { selected: [], text: "x" },
			fantome: { selected: [], text: "x" },
		});
		expect(errors.join(" ")).toContain("fantome");
	});
});
