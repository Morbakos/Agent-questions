import { HttpErrorResponse } from "@angular/common/http";
import type { ApiError } from "@agent-questions/shared";

/** Message to display for a server call error: the text returned by the API, otherwise a readable fallback. */
export function errorMessage(error: unknown, fallback = "Une erreur est survenue."): string {
	if (error instanceof HttpErrorResponse) {
		const body = error.error as ApiError | null;
		if (body?.error) {
			return body.details?.length ? `${body.error} (${body.details.join(" ; ")})` : body.error;
		}
		if (error.status === 0) {
			return "Serveur injoignable.";
		}
	}
	return fallback;
}
