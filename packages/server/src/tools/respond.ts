import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { ServerNotification, ServerRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { openInBrowser } from "../open.js";
import type { Session } from "../sessions.js";
import type { ToolContext } from "./context.js";

/** Objet `extra` fourni par le SDK à chaque appel d'outil. */
export type Extra = RequestHandlerExtra<ServerRequest, ServerNotification>;

const lastOpened = new Map<string, number>();

const json = (value: unknown) => ({
	content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
});

export const urlOf = ({ cfg }: ToolContext, s: Session) => `${cfg.baseUrl}/s/${s.id}`;

/** Paramètre `wait_seconds` commun aux outils qui attendent. La description est lue par les modèles. */
export function waitSecondsField({ cfg }: ToolContext, extraAdvice: string) {
	return z
		.number()
		.int()
		.min(0)
		.max(3600)
		.optional()
		.describe(
			`Leave it unset: the default (${cfg.defaultWaitSeconds}s) waits for the user's answers. ${extraAdvice}`.trim(),
		);
}

/** Ouvre le navigateur sauf si la page est déjà ouverte (vue récemment) ou vient d'être ouverte. */
function maybeOpen(ctx: ToolContext, s: Session): void {
	if (ctx.cfg.noOpen || s.status !== "pending") return;
	const now = Date.now();
	const seenRecently = s.lastSeenAt !== null && now - s.lastSeenAt < 60_000;
	const openedRecently = now - (lastOpened.get(s.id) ?? 0) < 120_000;
	if (seenRecently || openedRecently) return;
	lastOpened.set(s.id, now);
	openInBrowser(urlOf(ctx, s));
}

/** Transforme l'état d'une session en réponse d'outil, et marque comme livrées les réponses finales. */
export function toResult(ctx: ToolContext, s: Session) {
	if (s.status === "answered" && s.answers) {
		const given = s.answers;
		ctx.store.markDelivered(s.id);
		const answers = s.questions.map((q) => {
			const a = given[q.id] ?? { selected: [], text: "" };
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
		ctx.store.markDelivered(s.id);
		return json({
			status: "declined",
			session_id: s.id,
			reason: s.declineReason || "L'utilisateur a choisi de ne pas répondre.",
		});
	}
	return json({
		status: "pending",
		session_id: s.id,
		url: urlOf(ctx, s),
		message:
			"The user has not answered yet. Call get_answers with this session_id to keep waiting, " +
			"and tell the user they can open the url if the page did not open by itself. " +
			"If the user later tells you they have answered, call get_answers with this session_id to fetch the answers. " +
			"Do not re-ask the questions.",
	});
}

/** Attend la clôture de la session (avec progression et keepalive), puis répond à l'agent. */
export async function waitAndRespond(ctx: ToolContext, s: Session, waitSeconds: number | undefined, extra: Extra) {
	maybeOpen(ctx, s);
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
	notify(0, `En attente de la réponse de l'utilisateur : ${urlOf(ctx, s)}`);
	let tick = 0;
	const keepalive = setInterval(() => notify(++tick, "En attente de la réponse de l'utilisateur"), 15_000);
	const ms = Math.min(waitSeconds ?? ctx.cfg.defaultWaitSeconds, 3600) * 1000;
	const startedAt = Date.now();
	console.log(`[mcp] session ${s.id} : attente de ${ms / 1000}s`);
	try {
		const final = await ctx.store.wait(s.id, ms, extra.signal);
		const elapsed = Math.round((Date.now() - startedAt) / 1000);
		// signal.aborted : le client a fermé la connexion (délai d'attente côté client, annulation, coupure réseau).
		console.log(
			`[mcp] session ${s.id} : ${final.status} après ${elapsed}s` +
				(extra.signal.aborted ? " (appel interrompu par le client)" : ""),
		);
		return toResult(ctx, final);
	} finally {
		clearInterval(keepalive);
	}
}
