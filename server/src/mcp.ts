import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { ServerNotification, ServerRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { AppConfig } from "./config.js";
import { openInBrowser } from "./open.js";
import { QuestionSchema } from "./schema.js";
import type { Session, SessionStore } from "./sessions.js";

/** Objet `extra` fourni par le SDK à chaque appel d'outil. */
type Extra = RequestHandlerExtra<ServerRequest, ServerNotification>;

const lastOpened = new Map<string, number>();

const json = (value: unknown) => ({
	content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
});

export function createMcpServer(store: SessionStore, cfg: AppConfig): McpServer {
	// Sans ouverture automatique du navigateur (Docker, serveur distant), c'est à l'agent de transmettre l'adresse.
	// La page d'accueil liste les questions en attente et se rafraîchit seule : l'adresse de base suffit, l'agent peut
	// la donner AVANT l'appel, qui reste unique (ask_user attend la réponse). get_answers ne sert qu'après un timeout.
	const relayHint = cfg.noOpen
		? "The answer form does not open by itself. " +
			`Before calling this tool, tell the user to open ${cfg.baseUrl} in a browser: pending question sets are ` +
			"listed there and appear within a few seconds. Then call ask_user once: the call waits for the answers. " +
			"Only if it returns 'pending', call get_answers with the session_id."
		: "";
	const server = new McpServer(
		{ name: "agent-questions", version: "0.1.0" },
		relayHint ? { instructions: relayHint } : undefined,
	);

	const urlOf = (s: Session) => `${cfg.baseUrl}/s/${s.id}`;

	/** Ouvre le navigateur sauf si la page est déjà ouverte (vue récemment) ou vient d'être ouverte. */
	function maybeOpen(s: Session): void {
		if (cfg.noOpen || s.status !== "pending") return;
		const now = Date.now();
		const seenRecently = s.lastSeenAt !== null && now - s.lastSeenAt < 60_000;
		const openedRecently = now - (lastOpened.get(s.id) ?? 0) < 120_000;
		if (seenRecently || openedRecently) return;
		lastOpened.set(s.id, now);
		openInBrowser(urlOf(s));
	}

	function toResult(s: Session) {
		if (s.status === "answered" && s.answers) {
			store.markDelivered(s.id);
			const answers = s.questions.map((q) => {
				const a = s.answers![q.id] ?? { selected: [], text: "" };
				return {
					question_id: q.id,
					header: q.header,
					selected: a.selected.map((id) => ({
						id,
						label: q.options?.find((o) => o.id === id)?.label ?? id,
					})),
					text: a.text || undefined,
				};
			});
			return json({ status: "answered", session_id: s.id, answers });
		}
		if (s.status === "declined") {
			store.markDelivered(s.id);
			return json({
				status: "declined",
				session_id: s.id,
				reason: s.declineReason || "L'utilisateur a choisi de ne pas répondre.",
			});
		}
		return json({
			status: "pending",
			session_id: s.id,
			url: urlOf(s),
			message:
				"The user has not answered yet. Call get_answers with this session_id to keep waiting, " +
				"and tell the user they can open the url if the page did not open by itself. " +
				"If the user later tells you they have answered, call get_answers with this session_id to fetch the answers. " +
				"Do not re-ask the questions.",
		});
	}

	async function waitAndRespond(s: Session, waitSeconds: number | undefined, extra: Extra) {
		maybeOpen(s);
		const token = extra._meta?.progressToken;
		const notify = (progress: number, message: string) => {
			if (token === undefined) return;
			extra
				.sendNotification({
					method: "notifications/progress",
					params: { progressToken: token, progress, message },
				})
				.catch(() => {
					/* notification de progression : sans importance si elle échoue */
				});
		};
		notify(0, `En attente de la réponse de l'utilisateur : ${urlOf(s)}`);
		let tick = 0;
		const keepalive = setInterval(() => notify(++tick, "En attente de la réponse de l'utilisateur"), 15_000);
		const ms = Math.min(waitSeconds ?? cfg.defaultWaitSeconds, 3600) * 1000;
		const startedAt = Date.now();
		console.log(`[mcp] session ${s.id} : attente de ${ms / 1000}s`);
		try {
			const final = await store.wait(s.id, ms, extra.signal);
			const elapsed = Math.round((Date.now() - startedAt) / 1000);
			// signal.aborted : le client a fermé la connexion (délai d'attente côté client, annulation, coupure réseau).
			console.log(
				`[mcp] session ${s.id} : ${final.status} après ${elapsed}s` +
					(extra.signal.aborted ? " (appel interrompu par le client)" : ""),
			);
			return toResult(final);
		} finally {
			clearInterval(keepalive);
		}
	}

	server.registerTool(
		"ask_user",
		{
			title: "Ask the user (rich form)",
			description:
				"Ask the user a set of questions in a dedicated web form. Prefer this over inline questions when you " +
				"have several questions, long context (code, diffs, trade-offs) or many options. The call waits for the " +
				"answers. If the user has not answered in time the result is status 'pending' with a session_id: then " +
				"call get_answers. Never re-ask the same questions: reuse the session_id." +
				(relayHint ? ` ${relayHint}` : ""),
			inputSchema: {
				title: z.string().max(120).optional().describe("Short title of this question set"),
				questions: z.array(QuestionSchema).min(1).max(30),
				session_id: z
					.string()
					.uuid()
					.optional()
					.describe("Existing session to keep waiting on (returned by a previous 'pending' result)"),
				wait_seconds: z
					.number()
					.int()
					.min(0)
					.max(3600)
					.optional()
					.describe(
						`Leave it unset: the default (${cfg.defaultWaitSeconds}s) waits for the user's answers. ` +
							"A small value, and especially 0, returns 'pending' immediately without waiting: avoid it.",
					),
			},
		},
		async ({ title, questions, session_id, wait_seconds }, extra) => {
			const ids = questions.map((q) => q.id);
			if (new Set(ids).size !== ids.length) throw new Error("Duplicate question ids");
			const { session } = store.findOrCreate({
				sessionId: session_id,
				title: title ?? "Questions de l'agent",
				questions,
			});
			return waitAndRespond(session, wait_seconds, extra);
		},
	);

	server.registerTool(
		"update_questions",
		{
			title: "Edit the questions of a pending session",
			description:
				"Replace the questions (and optionally the title) of a session the user has not answered yet, e.g. to " +
				"fix a mistake or refine an option. Send the COMPLETE new list of questions, not a diff. The open form " +
				"refreshes by itself and the user's draft is kept for the questions whose id is unchanged. Keep the ids " +
				"of questions you only reword. Fails if the session is already answered or declined: call get_answers. " +
				"Like ask_user, the call then waits for the answers.",
			inputSchema: {
				session_id: z.string().uuid().describe("Session returned by ask_user"),
				questions: z.array(QuestionSchema).min(1).max(30),
				title: z.string().max(120).optional().describe("New title; unchanged if omitted"),
				wait_seconds: z
					.number()
					.int()
					.min(0)
					.max(3600)
					.optional()
					.describe(`Leave it unset: the default (${cfg.defaultWaitSeconds}s) waits for the user's answers.`),
			},
		},
		async ({ session_id, questions, title, wait_seconds }, extra) => {
			const ids = questions.map((q) => q.id);
			if (new Set(ids).size !== ids.length) throw new Error("Duplicate question ids");
			const current = store.get(session_id);
			if (!current) throw new Error(`session_id inconnu : ${session_id}`);
			if (current.status !== "pending") {
				throw new Error(
					`Session already ${current.status}: it cannot be edited. Call get_answers with this session_id.`,
				);
			}
			const session = store.updateQuestions(session_id, title, questions);
			console.log(`[mcp] session ${session.id} : questions modifiées (révision ${session.revision})`);
			return waitAndRespond(session, wait_seconds, extra);
		},
	);

	server.registerTool(
		"get_answers",
		{
			title: "Get the answers of a question session",
			description:
				"Wait for (or fetch) the answers of a session previously created with ask_user. " +
				"Returns status 'answered', 'declined' or 'pending'.",
			inputSchema: {
				session_id: z.string().uuid(),
				wait_seconds: z
					.number()
					.int()
					.min(0)
					.max(3600)
					.optional()
					.describe(
						`Leave it unset: the default (${cfg.defaultWaitSeconds}s) waits for the user's answers. ` +
							"0 only checks the current state without waiting.",
					),
			},
		},
		async ({ session_id, wait_seconds }, extra) => {
			const session = store.get(session_id);
			if (!session) throw new Error(`session_id inconnu : ${session_id}`);
			return waitAndRespond(session, wait_seconds, extra);
		},
	);

	return server;
}
