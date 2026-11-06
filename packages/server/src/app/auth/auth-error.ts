import { type ArgumentsHost, Catch, type ExceptionFilter } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { isMcpCall, toolError } from "@app/mcp/mcp-error-result.js";

/** Authentication refusal: 401 (missing or invalid identity) or 403 (valid identity, insufficient rights). */
export class AuthError extends Error {
	constructor(
		public readonly status: 401 | 403,
		message: string,
	) {
		super(message);
		this.name = "AuthError";
	}
}

/** Renders an `AuthError` as `{ error }` JSON (plus `WWW-Authenticate` on 401), or as a tool error during an MCP call. */
@Catch(AuthError)
export class AuthErrorFilter implements ExceptionFilter<AuthError> {
	catch(error: AuthError, host: ArgumentsHost): unknown {
		if (isMcpCall(host)) {
			return toolError(error.message);
		}
		const reply = host.switchToHttp().getResponse<FastifyReply>();
		if (error.status === 401) {
			reply.header("www-authenticate", 'Bearer realm="agent-questions"');
		}
		reply.code(error.status).send({ error: error.message });
		return undefined;
	}
}
