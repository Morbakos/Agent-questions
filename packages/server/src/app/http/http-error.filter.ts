import { ArgumentsHost, Catch, ExceptionFilter } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { isMcpCall, toolError } from "@app/mcp/mcp-error-result.js";
import { HttpError } from "./http-error.js";

/** Turns an `HttpError` into `{ error, details }` JSON, or, during an MCP tool call, into a tool error result (no HTTP reply). */
@Catch(HttpError)
export class HttpErrorFilter implements ExceptionFilter<HttpError> {
	catch(error: HttpError, host: ArgumentsHost): unknown {
		if (isMcpCall(host)) {
			return toolError(error.message);
		}
		const reply = host.switchToHttp().getResponse<FastifyReply>();
		reply.code(error.status).send({ error: error.message, details: error.details });
		return undefined;
	}
}
