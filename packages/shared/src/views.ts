// Contract of the UI API (`/api/sessions…`): the server produces it, the UI consumes it.
import type { Answers, Question } from "./schema.js";

/** `pending` until the user answers or declines; both other states are final (the session is then closed). */
export type Status = "pending" | "answered" | "declined";

/** Full session as the UI of its owner sees it. `draft` is the unsent form state; `answers` is set once answered. */
export interface SessionView {
	id: string;
	title: string;
	status: Status;
	/** Incremented each time the agent modifies the questions. */
	revision: number;
	questions: Question[];
	draft: Answers;
	answers: Answers | null;
	declineReason: string | null;
}

/** List entry of a session. Timestamps are milliseconds since the epoch. */
export interface SessionSummary {
	id: string;
	title: string;
	status: Status;
	createdAt: number;
	/** Date of the answer or refusal; `null` while the session is pending. */
	answeredAt: number | null;
	questionCount: number;
}

/** Admin view: one session of a user, read-only (the admin never answers in their place). */
export interface AdminSessionSummary extends SessionSummary {
	ownerId: string;
	ownerUsername: string;
}

export interface AdminSessionView extends SessionView {
	readOnly: true;
	ownerId: string;
	ownerUsername: string;
}

export interface AdminSessionPage {
	items: AdminSessionSummary[];
	/** Opaque cursor `<ms>:<id>` to pass as `before` for the next page; `null` at the end. */
	nextBefore: string | null;
}

/** One page of the history (closed sessions, most recent first). */
export interface SessionHistory {
	items: SessionSummary[];
	/** Opaque cursor `<ms>:<id>` to pass as `before` for the next page; `null` on the last page. */
	nextBefore: string | null;
}

/** `new-session` event of the `/api/events` stream: the agent has just sent new questions. */
export interface UiNewSessionEvent {
	sessionId: string;
	title: string;
}

/** Error body of the UI API. */
export interface ApiError {
	error?: string;
	details?: string[];
}
