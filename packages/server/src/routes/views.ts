import type { SessionSummary, SessionView } from "@agent-questions/shared";
import type { Session } from "../session-store.js";

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

/** Entrée de la liste des questions en attente ou de l'historique. */
export const summary = (s: Session): SessionSummary => ({
	id: s.id,
	title: s.title,
	status: s.status,
	createdAt: s.createdAt,
	answeredAt: s.answeredAt,
	questionCount: s.questions.length,
});
