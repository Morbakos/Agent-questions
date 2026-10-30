import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ToolContext } from "./context.js";
import { waitAndRespond, waitSecondsField } from "./respond.js";

export function registerGetAnswers(server: McpServer, ctx: ToolContext): void {
	server.registerTool(
		"get_answers",
		{
			title: "Get the answers of a question session",
			description:
				"Wait for (or fetch) the answers of a session previously created with ask_user. " +
				"Returns status 'answered', 'declined' or 'pending'.",
			inputSchema: {
				session_id: z.string().uuid(),
				wait_seconds: waitSecondsField(ctx, "0 only checks the current state without waiting."),
			},
		},
		async ({ session_id, wait_seconds }, extra) => {
			const session = ctx.store.get(session_id);
			if (!session) {
				throw new Error(`session_id inconnu : ${session_id}`);
			}
			return waitAndRespond(ctx, session, wait_seconds, extra);
		},
	);
}
