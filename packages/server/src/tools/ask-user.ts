import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { QuestionSchema } from "@agent-questions/shared";
import type { ToolContext } from "./context.js";
import { waitAndRespond, waitSecondsField } from "./respond.js";

export function registerAskUser(server: McpServer, ctx: ToolContext): void {
	server.registerTool(
		"ask_user",
		{
			title: "Ask the user (rich form)",
			description:
				"Ask the user a set of questions in a dedicated web form. Prefer this over inline questions when you " +
				"have several questions, long context (code, diffs, trade-offs) or many options. It is for open " +
				"questions and decisions you cannot make alone (choices, missing requirements, preferences), NOT for " +
				"asking the user to approve or validate your plan, your design or a change you are about to make: give " +
				"the plan in your normal reply or through your client's own approval step, and ask here only what would " +
				"change it. The call waits for the " +
				"answers, and the user may take a long time to give them: if your client can, run this call as a " +
				"background task (or in a background subagent) instead of blocking the main thread, keep working on " +
				"whatever does not depend on the answers, and handle the result when the call completes. " +
				"If the user has not answered in time the result is status 'pending' with a session_id: then " +
				"call get_answers. Never re-ask the same questions: reuse the session_id." +
				(ctx.relayHint ? ` ${ctx.relayHint}` : ""),
			inputSchema: {
				title: z.string().max(120).optional().describe("Short title of this question set"),
				questions: z.array(QuestionSchema).min(1).max(30),
				session_id: z
					.string()
					.uuid()
					.optional()
					.describe("Existing session to keep waiting on (returned by a previous 'pending' result)"),
				wait_seconds: waitSecondsField(
					ctx,
					"A small value, and especially 0, returns 'pending' immediately without waiting: avoid it.",
				),
			},
		},
		async ({ title, questions, session_id, wait_seconds }, extra) => {
			const ids = questions.map((q) => q.id);
			if (new Set(ids).size !== ids.length) {
				throw new Error("Duplicate question ids");
			}
			const { session, created } = ctx.store.findOrCreate({
				sessionId: session_id,
				title: title ?? "Questions de l'agent",
				questions,
			});
			if (created) {
				// Les onglets déjà ouverts le savent : l'UI décide d'y aller ou de le proposer.
				ctx.hub.announce(session);
			}
			return waitAndRespond(ctx, session, wait_seconds, extra);
		},
	);
}
