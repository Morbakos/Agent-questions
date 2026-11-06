import type { AppConfig } from "@app/config/config.js";

/**
 * Origins whose pages may make cookie-authenticated writes (CSRF: `enableCsrfProtection` and
 * `session.trustedOrigins`): the Angular dev server and `AQ_ALLOWED_ORIGINS`. The server's own origin is
 * always trusted.
 */
export const trustedOriginsOf = ({ dev, allowedOrigins }: AppConfig): string[] => [
	...(dev ? ["http://localhost:4200", "http://127.0.0.1:4200"] : []),
	...allowedOrigins,
];
