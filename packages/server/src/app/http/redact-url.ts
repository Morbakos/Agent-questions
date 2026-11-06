/**
 * Masks an invitation's secret in a URL meant for logs.
 *
 * Always pass URLs through it before logging.
 */
export const redactUrl = (url: string | undefined): string | undefined =>
	url?.replace(/(\/auth\/invitations\/)[^/?#]+/, "$1[masqué]");
