// Logique pure sur les questions et réponses, sans zod : l'UI l'importe à l'exécution.
import type { Answer, Answers, Question } from "./schema.js";

export const emptyAnswer = (): Answer => ({ selected: [], text: "" });

export const isRequired = (q: Question): boolean => q.required !== false;

export function isAnswered(q: Question, a?: Answer): boolean {
	if (!a) {
		return false;
	}
	if (q.type === "text") {
		return a.text.trim().length > 0;
	}
	return a.selected.length > 0 || (!!q.allow_other && a.text.trim().length > 0);
}

/** Retourne la liste des erreurs (vide si les réponses sont valides). */
export function validateAnswers(questions: Question[], answers: Answers): string[] {
	const errors: string[] = [];
	for (const q of questions) {
		const a = answers[q.id];
		if (isRequired(q) && !isAnswered(q, a)) {
			errors.push(`Réponse manquante : ${q.header ?? q.id}`);
		}
		if (!a) {
			continue;
		}
		const known = new Set((q.options ?? []).map((o) => o.id));
		for (const id of a.selected) {
			if (!known.has(id)) {
				errors.push(`Option inconnue « ${id} » pour ${q.id}`);
			}
		}
		if (q.type === "single" && a.selected.length > 1) {
			errors.push(`Une seule option attendue pour ${q.id}`);
		}
	}
	for (const id of Object.keys(answers)) {
		if (!questions.some((q) => q.id === id)) {
			errors.push(`Question inconnue : ${id}`);
		}
	}
	return errors;
}
