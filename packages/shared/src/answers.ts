// Pure logic on questions and answers, without zod: the UI imports it at runtime.
import type { Answer, Answers, Question } from "./schema.js";

/** A fresh answer with nothing selected and no text. */
export const emptyAnswer = (): Answer => ({ selected: [], text: "" });

/** Questions are required by default (`required` absent), unless `required: false`. */
export const isRequired = (q: Question): boolean => q.required !== false;

/** The "Autre" field is offered by default (`allow_other` absent), unless `allow_other: false`. */
export const allowsOther = (q: Question): boolean => q.allow_other !== false;

/** A note per selected option is offered by default (`allow_notes` absent), unless `allow_notes: false`. */
export const allowsNotes = (q: Question): boolean => q.allow_notes !== false;

/**
 * Whether an answer counts as filled in: non-blank text for `text` questions; otherwise at least one selected option,
 * or non-blank text when the "Autre" field is allowed.
 */
export function isAnswered(q: Question, a?: Answer): boolean {
	if (!a) {
		return false;
	}
	if (q.type === "text") {
		return a.text.trim().length > 0;
	}
	return a.selected.length > 0 || (allowsOther(q) && a.text.trim().length > 0);
}

/**
 * Returns the list of errors (empty if the answers are valid).
 *
 * Runs on both sides (the UI blocks submission, the server enforces it with a 422). Checks missing required answers,
 * unknown option ids, notes without a selected option or when notes are disabled, several options on a `single`
 * question, and answers keyed by an unknown question. Error messages are user-facing (French).
 */
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
		for (const [id, note] of Object.entries(a.notes ?? {})) {
			if (!a.selected.includes(id)) {
				errors.push(`Note sans option choisie « ${id} » pour ${q.id}`);
			} else if (!allowsNotes(q) && note.trim()) {
				errors.push(`Notes non autorisées pour ${q.id}`);
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
