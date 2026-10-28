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
	createdAt: number;
	questionCount: number;
}

/** Corps d'erreur de l'API de l'UI. */
export interface ApiError {
	error?: string;
	details?: string[];
}
