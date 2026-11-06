import type { z } from "zod";
import { HttpError } from "@app/http/http-error.js";

/** Validates a request body against a shared zod schema; otherwise 400 with the details of the offending fields. */
export function parseBody<S extends z.ZodType>(schema: S, body: unknown): z.output<S> {
	const result = schema.safeParse(body);
	if (!result.success) {
		throw new HttpError(
			400,
			"Requête invalide",
			result.error.issues.map((issue) => `${issue.path.join(".") || "corps"} : ${issue.message}`),
		);
	}
	return result.data;
}
