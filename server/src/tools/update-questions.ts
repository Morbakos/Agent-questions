import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { QuestionSchema } from "../schema.js";
import type { ToolContext } from "./context.js";
import { waitAndRespond, waitSecondsField } from "./respond.js";

export function registerUpdateQuestions(server: McpServer, ctx: ToolContext): void {
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
				wait_seconds: waitSecondsField(ctx, ""),
			},
		},
		async ({ session_id, questions, title, wait_seconds }, extra) => {
			const ids = questions.map((q) => q.id);
			if (new Set(ids).size !== ids.length) throw new Error("Duplicate question ids");
			const current = ctx.store.get(session_id);
			if (!current) throw new Error(`session_id inconnu : ${session_id}`);
			if (current.status !== "pending") {
				throw new Error(
					`Session already ${current.status}: it cannot be edited. Call get_answers with this session_id.`,
				);
			}
			const session = ctx.store.updateQuestions(session_id, title, questions);
			console.log(`[mcp] session ${session.id} : questions modifiées (révision ${session.revision})`);
			return waitAndRespond(ctx, session, wait_seconds, extra);
		},
	);
}
