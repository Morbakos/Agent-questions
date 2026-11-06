import type { ArgumentsHost } from "@nestjs/common";

/** True for a call coming from `@nestjs/mcp` (tool, resource, prompt), false for an HTTP request. */
export const isMcpCall = (host: ArgumentsHost): boolean => host.getType<string>() === "mcp";

/** MCP tool result in error: the message is read by the agent, who can use it to correct itself. */
export const toolError = (message: string) => ({
	content: [{ type: "text" as const, text: message }],
	isError: true,
});
