import type { ContentSecurityPolicyDirectiveValue, SecurityHeadersOptions } from "@nestjs/common";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AppConfig } from "@app/config/config.js";

/**
 * Directives of the CSP sent by the server. The UI is built with `security.autoCsp` (Angular): its critical CSS is
 * inlined, and the deferred loading of the stylesheet goes through a small inline script whose hash Angular computes
 * and publishes in a `<meta http-equiv="Content-Security-Policy">` tag of `index.html`. A header and a tag add up (the
 * strictest wins): the header must therefore reuse the tag's script policy, otherwise it would block the script the tag
 * allows. Without a built UI or without the tag, scripts are limited to the origin.
 */
export function contentSecurityDirectives(uiDir: string): Record<string, ContentSecurityPolicyDirectiveValue> {
	let scripts = ["'self'"];
	try {
		const html = readFileSync(join(uiDir, "index.html"), "utf8");
		const meta = /<meta[^>]*http-equiv="Content-Security-Policy"[^>]*content="([^"]*)"/i.exec(html)?.[1];
		const script = meta?.split(";").find((directive) => directive.trim().startsWith("script-src"));
		if (script) {
			scripts = script.trim().split(/\s+/).slice(1);
		}
	} catch {
		/* UI missing: fallback above */
	}
	return {
		"script-src": scripts,
		"object-src": ["'none'"],
		"default-src": ["'self'"],
		"img-src": ["'self'", "data:"],
		"style-src": ["'self'", "'unsafe-inline'"],
		"frame-ancestors": ["'none'"],
		"base-uri": ["'self'"],
		"form-action": ["'self'"],
	};
}

/**
 * Options of `app.useSecurityHeaders()` (Nest, same names as helmet). `useDefaults: false`: Nest's default CSP
 * contains `upgrade-insecure-requests`, which would break the UI served over HTTP on localhost. HSTS only for a
 * public HTTPS URL (browsers ignore it over HTTP).
 */
export function securityHeadersOf({ baseUrl, uiDir }: AppConfig): SecurityHeadersOptions {
	return {
		contentSecurityPolicy: { useDefaults: false, directives: contentSecurityDirectives(uiDir) },
		xFrameOptions: { action: "deny" },
		strictTransportSecurity:
			new URL(baseUrl).protocol === "https:" ? { maxAge: 31536000, includeSubDomains: false } : false,
	};
}
