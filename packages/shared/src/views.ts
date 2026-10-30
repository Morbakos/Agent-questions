// Contrat de l'API de l'UI (`/api/sessions…`) : le serveur le produit, l'UI le consomme.
import type { Answers, Question } from "./schema.js";

export type Status = "pending" | "answered" | "declined";

export interface SessionView {
	id: string;
	title: string;
	status: Status;
	/** Incrémentée à chaque modification des questions par l'agent. */
	revision: number;
	questions: Question[];
	draft: Answers;
	answers: Answers | null;
	declineReason: string | null;
}

export interface SessionSummary {
	id: string;
	title: string;
	status: Status;
	createdAt: number;
	/** Date de la réponse ou du refus ; `null` tant que la session est en attente. */
	answeredAt: number | null;
	questionCount: number;
}

/** Une page de l'historique (sessions clôturées, plus récentes d'abord). */
export interface SessionHistory {
	items: SessionSummary[];
	/** À passer en `before` pour obtenir la page suivante ; `null` à la dernière page. */
	nextBefore: number | null;
}

/** Corps d'erreur de l'API de l'UI. */
export interface ApiError {
	error?: string;
	details?: string[];
}
