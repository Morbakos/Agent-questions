/**
 * Keyset pagination cursor over `(timestamp DESC, id DESC)`. The id breaks ties between rows sharing the same
 * millisecond, so no row is skipped or repeated at a page boundary.
 */
export interface SessionCursor {
	/** Timestamp in ms: closing date for the history, creation date for the admin list. */
	at: number;
	/** Id of the last row of the previous page. */
	id: string;
}

/** Wire format of a cursor: `<ms>:<id>`. */
export const formatCursor = ({ at, id }: SessionCursor): string => `${at}:${id}`;
