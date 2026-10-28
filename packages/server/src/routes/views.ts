import type { SessionSummary, SessionView } from "@agent-questions/shared";
import type { Session } from "../sessions.js";

/** Vue d'une session pour le formulaire de l'UI. */
export const view = (s: Session): SessionView => ({
	id: s.id,
	title: s.title,
	status: s.status,
	revision: s.revision,
	questions: s.questions,
	draft: s.draft,
	answers: s.answers,
	declineReason: s.declineReason,
});

/** Entrée de la liste des questions en attente. */
export const summary = (s: Session): SessionSummary => ({
	id: s.id,
	title: s.title,
	createdAt: s.createdAt,
	questionCount: s.questions.length,
});
