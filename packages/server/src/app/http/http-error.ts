/** Application error carrying an HTTP status; `HttpErrorFilter` turns it into a `{ error, details }` JSON response. */
export class HttpError extends Error {
	/**
	 * @param status HTTP status code.
	 * @param message User-facing message; also what an MCP agent reads when the error is thrown during a tool call.
	 * @param details Optional list of precise problems (e.g. validation errors).
	 */
	constructor(
		public status: number,
		message: string,
		public details?: string[],
	) {
		super(message);
	}
}
