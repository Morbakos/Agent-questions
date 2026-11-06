import type { SessionSummary, SessionView } from "@agent-questions/shared";
import type { Session } from "@app/sessions/domain/session.js";

/** UI projection of a session: drops the internal fields (`ownerId`, hash, timestamps). */
export const view = ({
	id,
	title,
	status,
	revision,
	questions,
	draft,
	answers,
	declineReason,
}: Session): SessionView => ({ id, title, status, revision, questions, draft, answers, declineReason });

export const summary = ({ id, title, status, createdAt, answeredAt, questions }: Session): SessionSummary => ({
	id,
	title,
	status,
	createdAt,
	answeredAt,
	questionCount: questions.length,
});
