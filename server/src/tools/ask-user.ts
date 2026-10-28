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
				"have several questions, long context (code, diffs, trade-offs) or many options. The call waits for the " +
				"answers. If the user has not answered in time the result is status 'pending' with a session_id: then " +
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
			if (new Set(ids).size !== ids.length) throw new Error("Duplicate question ids");
			const { session } = ctx.store.findOrCreate({
				sessionId: session_id,
				title: title ?? "Questions de l'agent",
				questions,
			});
			return waitAndRespond(ctx, session, wait_seconds, extra);
		},
	);
}
