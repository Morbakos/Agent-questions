import type { SessionCursor } from "@app/sessions/domain/session-cursor.js";
import { HttpError } from "./http-error.js";

/**
 * Pagination cursor (`before`), formatted `<ms>:<id>` (see `formatCursor`): the timestamp in ms and the id of the last
 * item of the previous page. Malformed: 400. Absent: `undefined` (first page).
 */
export function parseCursor(value: string | undefined): SessionCursor | undefined {
	if (value === undefined) {
		return undefined;
	}
	const [, at, id] = /^(\d{1,16}):([A-Za-z0-9_-]{1,64})$/.exec(value) ?? [];
	if (at === undefined || id === undefined) {
		throw new HttpError(400, "Curseur invalide");
	}
	return { at: Number(at), id };
}
