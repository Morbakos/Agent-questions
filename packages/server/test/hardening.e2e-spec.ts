import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { redactUrl } from "@app/application.js";
import { contentSecurityDirectives } from "@app/http/security-headers.js";
import { createTestApplication, testConfig } from "@server/test-helpers.js";

const HOST = { host: "127.0.0.1:4317" };
let app: NestFastifyApplication | undefined;

const start = async (overrides: Parameters<typeof testConfig>[0] = {}) => {
	app = await createTestApplication({ config: testConfig(overrides) });
	await app.init();
	await app.getHttpAdapter().getInstance().ready();
	return app;
};
const inject = (options: Record<string, unknown>) =>
	app
		?.getHttpAdapter()
		.getInstance()
		.inject({ ...options, headers: { ...HOST, ...((options.headers as object) ?? {}) } } as never);

afterEach(async () => {
	await app?.close();
	app = undefined;
});

describe("request body size", () => {
	const mcpCall = (padBytes: number) =>
		inject({
			method: "POST",
			url: "/mcp",
			headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
			payload: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping", pad: "x".repeat(padBytes) }),
		});

	it("accepts a body above Fastify's 1 MiB default, up to the 10 MiB limit", async () => {
		await start();
		expect((await mcpCall(2 * 1024 * 1024))?.statusCode).not.toBe(413);
	});

	it("rejects a body above 10 MiB with 413", async () => {
		await start();
		expect((await mcpCall(11 * 1024 * 1024))?.statusCode).toBe(413);
	});
});

describe("security headers", () => {
	it("sets nosniff, anti-framing, referrer and CSP on every response, and no-store on the API", async () => {
		await start();
		const api = await inject({ method: "GET", url: "/api/sessions" });
		expect(api?.headers["x-content-type-options"]).toBe("nosniff");
		expect(api?.headers["x-frame-options"]).toBe("DENY");
		expect(api?.headers["referrer-policy"]).toBe("no-referrer");
		expect(String(api?.headers["content-security-policy"])).toContain("frame-ancestors 'none'");
		// `upgrade-insecure-requests` (Nest's default CSP) would break the UI over HTTP on localhost.
		expect(String(api?.headers["content-security-policy"])).not.toContain("upgrade-insecure-requests");
		expect(api?.headers["cache-control"]).toBe("no-store");
		expect(api?.headers["strict-transport-security"]).toBeUndefined();
	});

	it("adds HSTS only for an HTTPS public URL", async () => {
		await start({ baseUrl: "https://questions.example.com" });
		const response = await inject({
			method: "GET",
			url: "/health",
			headers: { host: "questions.example.com" },
		});
		expect(response?.headers["strict-transport-security"]).toContain("max-age=");
	});
});

describe("CORS", () => {
	it("advertises PATCH and the authentication headers in the preflight of an allowed origin", async () => {
		await start({ allowedOrigins: ["https://ui.example.com"] });
		const response = await inject({
			method: "OPTIONS",
			url: "/api/admin/users/u1",
			headers: { origin: "https://ui.example.com", "access-control-request-method": "PATCH" },
		});
		expect(response?.statusCode).toBe(204);
		expect(String(response?.headers["access-control-allow-methods"])).toContain("PATCH");
		const allowed = String(response?.headers["access-control-allow-headers"]);
		expect(allowed).toContain("authorization");
		expect(allowed).not.toContain("x-aq-csrf"); // CSRF: `Sec-Fetch-Site` / `Origin`, no custom header any more
		expect(response?.headers["access-control-allow-credentials"]).toBe("true");
	});

	it("sets the CORS headers on a /mcp response too (which @nestjs/mcp writes on reply.raw, after a hijack)", async () => {
		await start({ allowedOrigins: ["https://ui.example.com"] });
		const response = await inject({
			method: "POST",
			url: "/mcp",
			headers: {
				origin: "https://ui.example.com",
				"content-type": "application/json",
				accept: "application/json, text/event-stream",
			},
			payload: { jsonrpc: "2.0", id: 1, method: "tools/list" },
		});
		expect(response?.statusCode).toBe(200);
		expect(response?.headers["access-control-allow-origin"]).toBe("https://ui.example.com");
		expect(response?.headers["access-control-allow-credentials"]).toBe("true");
	});
});

describe("unknown routes", () => {
	it("answers 404 as JSON for an unknown API or OAuth discovery route, instead of the UI page", async () => {
		await start();
		for (const url of ["/api/nope", "/auth/nope", "/mcp/extra", "/.well-known/oauth-protected-resource"]) {
			const response = await inject({ method: "GET", url });
			expect(response?.statusCode, url).toBe(404);
			expect(response?.json()).toEqual({ error: "Route introuvable" });
		}
	});
});

describe("session decline", () => {
	it("answers 400, not 500, when the reason is not a string", async () => {
		await start();
		const response = await inject({
			method: "POST",
			url: "/api/sessions/inconnue/decline",
			payload: { reason: 123 },
		});
		expect(response?.statusCode).toBe(400);
	});
});

describe("logs", () => {
	it("masks an invitation token in the logged URL", () => {
		expect(redactUrl("/auth/invitations/abcDEF123_-?x=1")).toBe("/auth/invitations/[masqué]?x=1");
		expect(redactUrl("/api/sessions")).toBe("/api/sessions");
		expect(redactUrl(undefined)).toBeUndefined();
	});
});

describe("contentSecurityPolicy", () => {
	it("reuses the hash-based script policy that Angular (autoCsp) placed in index.html", () => {
		const dir = mkdtempSync(join(tmpdir(), "aq-ui-"));
		try {
			writeFileSync(
				join(dir, "index.html"),
				`<meta http-equiv="Content-Security-Policy" content="script-src 'strict-dynamic' 'sha256-abc=' https: 'unsafe-inline';object-src 'none';base-uri 'self';">`,
			);
			const directives = contentSecurityDirectives(dir);
			expect(directives["script-src"]).toEqual([
				"'strict-dynamic'",
				"'sha256-abc='",
				"https:",
				"'unsafe-inline'",
			]);
			expect(directives["frame-ancestors"]).toEqual(["'none'"]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("limits scripts to the origin when the UI is absent or has no tag", () => {
		expect(contentSecurityDirectives("/inexistant")["script-src"]).toEqual(["'self'"]);
	});
});

describe("exception filters on MCP calls", () => {
	it("an application HttpError becomes a tool result readable by the agent, not a broken HTTP response", async () => {
		const { HttpErrorFilter } = await import("@app/http/http-error.filter.js");
		const { HttpError } = await import("@app/http/http-error.js");
		const host = { getType: () => "mcp" } as never;
		const result = new HttpErrorFilter().catch(new HttpError(404, "session_id inconnu : x"), host);
		expect(result).toEqual({ content: [{ type: "text", text: "session_id inconnu : x" }], isError: true });
	});

	it("authentication denials too, without touching an HTTP response", async () => {
		const { AuthError, AuthErrorFilter } = await import("@app/auth/auth-error.js");
		const host = { getType: () => "mcp", switchToHttp: () => expect.unreachable() } as never;
		expect(new AuthErrorFilter().catch(new AuthError(403, "Droits insuffisants"), host)).toMatchObject({
			isError: true,
		});
	});
});
