import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { get } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Logger } from "@nestjs/common";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
	AdminSessionPage,
	AdminSessionView,
	AuthMe,
	CreatedApiToken,
	UserInvitation,
	UserSummary,
} from "@agent-questions/shared";
import type { AppConfig } from "@app/config/config.js";
import { MikroORM } from "@mikro-orm/core";
import { MikroUserRepository } from "@app/auth/persistence/mikro-user.repository.js";
import { SessionsService } from "@app/sessions/sessions.service.js";
import { createOrm } from "@app/storage/orm.js";
import { createTestApplication, testConfig, textQuestion } from "@server/test-helpers.js";

const ADMIN_PASSWORD = "mot-de-passe-admin";
const HOST = { host: "127.0.0.1:4317" };
const MCP_HEADERS = { "content-type": "application/json", accept: "application/json, text/event-stream" };
const INITIALIZE = {
	jsonrpc: "2.0",
	id: 1,
	method: "initialize",
	params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "0" } },
};

const serverConfig = (overrides: Partial<AppConfig> = {}): AppConfig =>
	testConfig({ deploymentMode: "server", admin: { username: "admin", password: ADMIN_PASSWORD }, ...overrides });

let apps: NestFastifyApplication[] = [];
const start = async (config: AppConfig = serverConfig()) => {
	const app = await createTestApplication({ config });
	await app.init();
	await app.getHttpAdapter().getInstance().ready();
	apps.push(app);
	return { app };
};

const call = (app: NestFastifyApplication, options: Record<string, unknown>) =>
	app
		.getHttpAdapter()
		.getInstance()
		.inject({ ...options, headers: { ...HOST, ...((options.headers as object) ?? {}) } } as never);

/** Signs in and returns the headers of a logged-in browser (cookie). */
const login = async (app: NestFastifyApplication, username = "admin", password = ADMIN_PASSWORD) => {
	const response = await call(app, { method: "POST", url: "/auth/login", payload: { username, password } });
	expect(response.statusCode, response.body).toBe(200);
	return { cookie: String(response.headers["set-cookie"]).split(";")[0] ?? "" };
};

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
const tokenOf = (inviteUrl: string) => inviteUrl.split("/invite/")[1] ?? "";

/** Creates a "member" account through the admin API, activates it with a password, and returns its browser headers. */
async function createMember(
	app: NestFastifyApplication,
	admin: object,
	username = "bob",
	password = "mot-de-passe-bob",
) {
	const created = await call(app, { method: "POST", url: "/api/admin/users", headers: admin, payload: { username } });
	expect(created.statusCode, created.body).toBe(201);
	const invitation = created.json<UserInvitation>();
	const accepted = await call(app, {
		method: "POST",
		url: `/auth/invitations/${tokenOf(invitation.inviteUrl)}`,
		payload: { password },
	});
	expect(accepted.statusCode, accepted.body).toBe(200);
	return {
		user: invitation.user,
		headers: { cookie: String(accepted.headers["set-cookie"]).split(";")[0] ?? "" },
	};
}

afterEach(async () => {
	await Promise.all(apps.map((app) => app.close()));
	apps = [];
	vi.restoreAllMocks();
});

describe("first administrator bootstrap", () => {
	it("creates the configured admin, who can sign in", async () => {
		const { app } = await start();
		const admin = await login(app);
		const me = await call(app, { method: "GET", url: "/auth/me", headers: admin });
		expect(me.json<AuthMe>()).toMatchObject({ mode: "server", username: "admin", role: "admin" });
	});

	it("generates a password shown only once when none is configured", async () => {
		const warn = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
		const { app } = await start(serverConfig({ admin: { username: "root", password: null } }));
		const message = warn.mock.calls.map((args) => String(args[0])).find((text) => text.includes("root")) ?? "";
		const generated = /mot de passe « ([^»\s]+) »/.exec(message)?.[1];
		expect(generated).toBeTruthy();
		await login(app, "root", generated ?? "");
	});

	it("refuses to start when the configured admin password is too short and the admin must be created", async () => {
		const app = await createTestApplication({
			config: serverConfig({ admin: { username: "admin", password: "court" } }),
		});
		apps.push(app);
		await expect(app.init()).rejects.toThrow(/AQ_ADMIN_PASSWORD/);
	});

	it("starts despite an invalid admin password when accounts already exist", async () => {
		const dir = mkdtempSync(join(tmpdir(), "aq-auth-"));
		const dbFile = join(dir, "base.sqlite");
		const seed = await createOrm(dbFile);
		await new MikroUserRepository(seed).create({ username: "alice", role: "admin", passwordHash: null });
		await seed.close();
		const { app } = await start(serverConfig({ dbFile, admin: { username: "admin", password: "court" } }));
		expect(app).toBeDefined();
	});

	it("creates nothing when accounts already exist", async () => {
		// File-based database: the account exists before the application starts (the `:memory:` database dies with it).
		const dir = mkdtempSync(join(tmpdir(), "aq-auth-"));
		const dbFile = join(dir, "base.sqlite");
		const seed = await createOrm(dbFile);
		await new MikroUserRepository(seed).create({ username: "alice", role: "admin", passwordHash: null });
		await seed.close();
		const { app } = await start(serverConfig({ dbFile }));
		const orm = app.get<MikroORM>(MikroORM);
		expect(await new MikroUserRepository(orm).findByUsername("admin")).toBeUndefined();
		expect(
			(
				await call(app, {
					method: "POST",
					url: "/auth/login",
					payload: { username: "admin", password: ADMIN_PASSWORD },
				})
			).statusCode,
		).toBe(401);
	});
});

describe("sign-in", () => {
	it("denies anonymous access to the API, events and MCP, but leaves /health public", async () => {
		const { app } = await start();
		for (const [method, url] of [
			["GET", "/api/sessions"],
			["GET", "/api/sessions/history"],
			["GET", "/api/sessions/x"],
			["PUT", "/api/sessions/x/draft"],
			["POST", "/api/sessions/x/answers"],
			["POST", "/api/sessions/x/decline"],
			["GET", "/api/events"],
			["POST", "/mcp"],
			["GET", "/auth/me"],
			["GET", "/api/account/tokens"],
			["GET", "/api/admin/users"],
		] as const) {
			const response = await call(app, { method, url, payload: method === "GET" ? undefined : {} });
			expect(response.statusCode, `${method} ${url}`).toBe(401);
		}
		expect((await call(app, { method: "GET", url: "/health" })).statusCode).toBe(200);
	});

	it("answers 404 (not 401) to an unknown route under a reserved prefix: OAuth discovery does not start", async () => {
		const { app } = await start();
		for (const url of [
			"/.well-known/oauth-protected-resource",
			"/.well-known/oauth-authorization-server",
			"/api/nope",
		]) {
			const response = await call(app, { method: "GET", url });
			expect(response.statusCode, url).toBe(404);
			expect(response.headers["www-authenticate"], url).toBeUndefined();
			expect(response.json()).toEqual({ error: "Route introuvable" });
		}
	});

	it("answers the same for a wrong password and an unknown account", async () => {
		const { app } = await start();
		const wrong = await call(app, {
			method: "POST",
			url: "/auth/login",
			payload: { username: "admin", password: "faux-mot-de-passe" },
		});
		const unknown = await call(app, {
			method: "POST",
			url: "/auth/login",
			payload: { username: "inconnu", password: "faux-mot-de-passe" },
		});
		expect(wrong.statusCode).toBe(401);
		expect(unknown.statusCode).toBe(401);
		expect(unknown.json()).toEqual(wrong.json());
	});

	it("sets an HttpOnly, SameSite=Lax cookie, and Secure only over HTTPS", async () => {
		const http = await start();
		const plain = await call(http.app, {
			method: "POST",
			url: "/auth/login",
			payload: { username: "admin", password: ADMIN_PASSWORD },
		});
		expect(String(plain.headers["set-cookie"])).toMatch(/HttpOnly.*SameSite=Lax|SameSite=Lax.*HttpOnly/);
		expect(String(plain.headers["set-cookie"])).not.toContain("Secure");

		const https = await start(serverConfig({ baseUrl: "https://questions.example.com" }));
		const secure = await call(https.app, {
			method: "POST",
			url: "/auth/login",
			headers: { host: "questions.example.com" },
			payload: { username: "admin", password: ADMIN_PASSWORD },
		});
		expect(String(secure.headers["set-cookie"])).toContain("Secure");
	});

	it("protects cookie-authenticated mutations against CSRF", async () => {
		const { app } = await start();
		const { cookie } = await login(app);
		// A write that a browser declares as coming from another origin is rejected, even with a valid cookie.
		for (const headers of [
			{ cookie, "sec-fetch-site": "cross-site" },
			{ cookie, "sec-fetch-site": "same-site" },
			{ cookie, origin: "http://evil.example" },
		]) {
			const foreign = await call(app, { method: "POST", url: "/api/sessions/x/decline", headers });
			expect(foreign.statusCode, JSON.stringify(headers)).toBe(403);
		}
		// Same origin, or a non-browser client (neither `Sec-Fetch-Site` nor `Origin`): authenticated, the session simply does not exist.
		for (const headers of [{ cookie }, { cookie, "sec-fetch-site": "same-origin" }]) {
			const own = await call(app, { method: "POST", url: "/api/sessions/x/decline", headers });
			expect(own.statusCode, JSON.stringify(headers)).toBe(404);
		}
		expect((await call(app, { method: "GET", url: "/api/sessions", headers: { cookie } })).statusCode).toBe(200);
	});

	it("accepts writes from a declared origin (AQ_ALLOWED_ORIGINS, Angular dev server)", async () => {
		const { app } = await start(serverConfig({ allowedOrigins: ["https://ui.example"], dev: true }));
		const { cookie } = await login(app);
		for (const origin of ["https://ui.example", "http://localhost:4200"]) {
			const response = await call(app, {
				method: "POST",
				url: "/api/sessions/x/decline",
				headers: { cookie, origin, "sec-fetch-site": "cross-site" },
			});
			expect(response.statusCode, origin).toBe(404); // authenticated: the session simply does not exist
		}
		const other = await call(app, {
			method: "POST",
			url: "/api/sessions/x/decline",
			headers: { cookie, origin: "https://autre.example", "sec-fetch-site": "cross-site" },
		});
		expect(other.statusCode).toBe(403);
	});

	it("sign-out invalidates the session on the server side", async () => {
		const { app } = await start();
		const admin = await login(app);
		expect((await call(app, { method: "POST", url: "/auth/logout", headers: admin })).statusCode).toBe(200);
		expect((await call(app, { method: "GET", url: "/auth/me", headers: admin })).statusCode).toBe(401);
	});

	it("throttles attempts: 429 after 10 failures, even with the right password", async () => {
		const { app } = await start();
		for (let attempt = 0; attempt < 10; attempt += 1) {
			const response = await call(app, {
				method: "POST",
				url: "/auth/login",
				payload: { username: "admin", password: `faux-${attempt}-mot-de-passe` },
			});
			expect(response.statusCode).toBe(401);
		}
		const blocked = await call(app, {
			method: "POST",
			url: "/auth/login",
			payload: { username: "admin", password: ADMIN_PASSWORD },
		});
		expect(blocked.statusCode).toBe(429);
	});

	it("ignores the X-User / X-Tenant headers supplied by the client", async () => {
		const { app } = await start();
		const spoof = { "x-user": "admin", "x-tenant": "autre", "x-forwarded-user": "admin" };
		expect((await call(app, { method: "GET", url: "/api/sessions", headers: spoof })).statusCode).toBe(401);
	});

	it("writes no password, cookie or token to the logs", async () => {
		const warn = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
		const { app } = await start();
		await call(app, {
			method: "POST",
			url: "/auth/login",
			payload: { username: "admin", password: "secret-tente" },
		});
		await call(app, {
			method: "GET",
			url: "/api/sessions",
			headers: { cookie: "sid=cookie-secret", ...bearer("aq_jeton-secret") },
		});
		await call(app, { method: "GET", url: "/api/sessions", headers: { cookie: "sid=cookie-secret" } });
		const logged = warn.mock.calls.map((args) => String(args[0])).join("\n");
		expect(logged).toContain("401");
		for (const secret of ["secret-tente", "cookie-secret", "jeton-secret", ADMIN_PASSWORD]) {
			expect(logged).not.toContain(secret);
		}
	});
});

describe("invitations and administration", () => {
	it("an admin creates an account, the invitee picks a password, the link works only once", async () => {
		const { app } = await start();
		const admin = await login(app);
		const created = await call(app, {
			method: "POST",
			url: "/api/admin/users",
			headers: admin,
			payload: { username: "bob" },
		});
		const invitation = created.json<UserInvitation>();
		expect(invitation.user).toMatchObject({ username: "bob", role: "member", pending: true, disabled: false });
		expect(invitation.inviteUrl).toMatch(/^http:\/\/127\.0\.0\.1:4317\/invite\/[\w-]{20,}$/);
		const token = tokenOf(invitation.inviteUrl);

		expect((await call(app, { method: "GET", url: `/auth/invitations/${token}` })).json()).toEqual({
			username: "bob",
		});
		const weak = await call(app, {
			method: "POST",
			url: `/auth/invitations/${token}`,
			payload: { password: "court" },
		});
		expect(weak.statusCode).toBe(400);
		const accepted = await call(app, {
			method: "POST",
			url: `/auth/invitations/${token}`,
			payload: { password: "mot-de-passe-bob" },
		});
		expect(accepted.statusCode).toBe(200);
		const bob = { cookie: String(accepted.headers["set-cookie"]).split(";")[0] ?? "" };
		expect((await call(app, { method: "GET", url: "/auth/me", headers: bob })).json<AuthMe>()).toMatchObject({
			username: "bob",
			role: "member",
		});

		expect((await call(app, { method: "GET", url: `/auth/invitations/${token}` })).statusCode).toBe(404);
		expect(
			(
				await call(app, {
					method: "POST",
					url: `/auth/invitations/${token}`,
					payload: { password: "un-autre-mot-de-passe" },
				})
			).statusCode,
		).toBe(404);
		await login(app, "bob", "mot-de-passe-bob");
	});

	it("rejects a username already taken (case-insensitively) or invalid", async () => {
		const { app } = await start();
		const admin = await login(app);
		await createMember(app, admin, "bob");
		const duplicate = await call(app, {
			method: "POST",
			url: "/api/admin/users",
			headers: admin,
			payload: { username: "BOB" },
		});
		expect(duplicate.statusCode).toBe(409);
		const invalid = await call(app, {
			method: "POST",
			url: "/api/admin/users",
			headers: admin,
			payload: { username: "a b" },
		});
		expect(invalid.statusCode).toBe(400);
	});

	it("reserves administration to admins (403 for a member)", async () => {
		const { app } = await start();
		const { headers: bob, user } = await createMember(app, await login(app));
		for (const [method, url, payload] of [
			["GET", "/api/admin/users", undefined],
			["POST", "/api/admin/users", { username: "eve" }],
			["POST", `/api/admin/users/${user.id}/invitation`, {}],
			["PATCH", `/api/admin/users/${user.id}`, { role: "admin" }],
		] as const) {
			const response = await call(app, { method, url, headers: bob, payload });
			expect(response.statusCode, `${method} ${url}`).toBe(403);
		}
	});

	it("lists accounts, never exposing a password", async () => {
		const { app } = await start();
		const admin = await login(app);
		await createMember(app, admin);
		const list = await call(app, { method: "GET", url: "/api/admin/users", headers: admin });
		expect(list.json<UserSummary[]>().map((u) => u.username)).toEqual(["admin", "bob"]);
		expect(list.body).not.toMatch(/password|hash|scrypt/i);
	});

	it("a new invitation link replaces the old one", async () => {
		const { app } = await start();
		const admin = await login(app);
		const first = (
			await call(app, { method: "POST", url: "/api/admin/users", headers: admin, payload: { username: "bob" } })
		).json<UserInvitation>();
		const second = (
			await call(app, {
				method: "POST",
				url: `/api/admin/users/${first.user.id}/invitation`,
				headers: admin,
				payload: {},
			})
		).json<UserInvitation>();
		expect(
			(await call(app, { method: "GET", url: `/auth/invitations/${tokenOf(first.inviteUrl)}` })).statusCode,
		).toBe(404);
		expect(
			(await call(app, { method: "GET", url: `/auth/invitations/${tokenOf(second.inviteUrl)}` })).statusCode,
		).toBe(200);
	});

	it("disabling an account closes its sessions and revokes its tokens", async () => {
		const { app } = await start();
		const admin = await login(app);
		const { headers: bob, user } = await createMember(app, admin);
		const token = (
			await call(app, { method: "POST", url: "/api/account/tokens", headers: bob, payload: { name: "mcp" } })
		).json<CreatedApiToken>().token;
		const mcpCall = async () =>
			(
				await call(app, {
					method: "POST",
					url: "/mcp",
					headers: { ...MCP_HEADERS, ...bearer(token) },
					payload: INITIALIZE,
				})
			).statusCode;
		expect(await mcpCall()).toBe(200);

		const disabled = await call(app, {
			method: "PATCH",
			url: `/api/admin/users/${user.id}`,
			headers: admin,
			payload: { disabled: true },
		});
		expect(disabled.json<UserSummary>().disabled).toBe(true);
		expect((await call(app, { method: "GET", url: "/auth/me", headers: bob })).statusCode).toBe(401);
		expect(await mcpCall()).toBe(401);
		expect(
			(
				await call(app, {
					method: "POST",
					url: "/auth/login",
					payload: { username: "bob", password: "mot-de-passe-bob" },
				})
			).statusCode,
		).toBe(401);

		await call(app, {
			method: "PATCH",
			url: `/api/admin/users/${user.id}`,
			headers: admin,
			payload: { disabled: false },
		});
		await login(app, "bob", "mot-de-passe-bob");
	});

	it("disabling with revokeTokens deletes the tokens: re-enabling does not bring them back", async () => {
		const { app } = await start();
		const admin = await login(app);
		const { headers: bob, user } = await createMember(app, admin);
		const created = (
			await call(app, { method: "POST", url: "/api/account/tokens", headers: bob, payload: { name: "mcp" } })
		).json<CreatedApiToken>();
		const mcpCall = async () =>
			(
				await call(app, {
					method: "POST",
					url: "/mcp",
					headers: { ...MCP_HEADERS, ...bearer(created.token) },
					payload: INITIALIZE,
				})
			).statusCode;
		const patch = (payload: object) =>
			call(app, { method: "PATCH", url: `/api/admin/users/${user.id}`, headers: admin, payload });
		expect(await mcpCall()).toBe(200);

		expect((await patch({ disabled: true, revokeTokens: true })).statusCode).toBe(200);
		expect(await mcpCall()).toBe(401);

		await patch({ disabled: false });
		expect(await mcpCall()).toBe(401);
		const bobAgain = await login(app, "bob", "mot-de-passe-bob");
		expect(
			(await call(app, { method: "GET", url: "/api/account/tokens", headers: bobAgain })).json<unknown[]>(),
		).toEqual([]);
	});

	it("disabling without revokeTokens keeps the tokens: refused meanwhile, valid again after re-enabling", async () => {
		const { app } = await start();
		const admin = await login(app);
		const { headers: bob, user } = await createMember(app, admin);
		const { token } = (
			await call(app, { method: "POST", url: "/api/account/tokens", headers: bob, payload: { name: "mcp" } })
		).json<CreatedApiToken>();
		const mcpCall = async () =>
			(
				await call(app, {
					method: "POST",
					url: "/mcp",
					headers: { ...MCP_HEADERS, ...bearer(token) },
					payload: INITIALIZE,
				})
			).statusCode;
		const patch = (payload: object) =>
			call(app, { method: "PATCH", url: `/api/admin/users/${user.id}`, headers: admin, payload });

		await patch({ disabled: true });
		expect(await mcpCall()).toBe(401);
		await patch({ disabled: false });
		expect(await mcpCall()).toBe(200);
		// `revokeTokens` without disabling deletes nothing.
		await patch({ role: "admin", revokeTokens: true });
		expect(await mcpCall()).toBe(200);
	});

	it("always keeps an active administrator", async () => {
		const { app } = await start();
		const admin = await login(app);
		const me = (await call(app, { method: "GET", url: "/auth/me", headers: admin })).json<AuthMe>();
		const demote = await call(app, {
			method: "PATCH",
			url: `/api/admin/users/${me.userId}`,
			headers: admin,
			payload: { role: "member" },
		});
		expect(demote.statusCode).toBe(409);
		const disable = await call(app, {
			method: "PATCH",
			url: `/api/admin/users/${me.userId}`,
			headers: admin,
			payload: { disabled: true },
		});
		expect(disable.statusCode).toBe(409);

		// With a second admin, the first can become a member.
		const { user } = await createMember(app, admin, "carol");
		await call(app, {
			method: "PATCH",
			url: `/api/admin/users/${user.id}`,
			headers: admin,
			payload: { role: "admin" },
		});
		const ok = await call(app, {
			method: "PATCH",
			url: `/api/admin/users/${me.userId}`,
			headers: admin,
			payload: { role: "member" },
		});
		expect(ok.statusCode).toBe(200);
	});
});

describe("user account", () => {
	it("changing the password requires the current one and closes the other sessions", async () => {
		const { app } = await start();
		const first = await login(app);
		const second = await login(app);
		const wrong = await call(app, {
			method: "POST",
			url: "/api/account/password",
			headers: first,
			payload: { current: "pas-le-bon-mot-de-passe", next: "nouveau-mot-de-passe" },
		});
		expect(wrong.statusCode).toBe(403);
		const weak = await call(app, {
			method: "POST",
			url: "/api/account/password",
			headers: first,
			payload: { current: ADMIN_PASSWORD, next: "court" },
		});
		expect(weak.statusCode).toBe(400);
		const changed = await call(app, {
			method: "POST",
			url: "/api/account/password",
			headers: first,
			payload: { current: ADMIN_PASSWORD, next: "nouveau-mot-de-passe" },
		});
		expect(changed.statusCode).toBe(200);

		expect((await call(app, { method: "GET", url: "/auth/me", headers: first })).statusCode).toBe(200);
		expect((await call(app, { method: "GET", url: "/auth/me", headers: second })).statusCode).toBe(401);
		expect(
			(
				await call(app, {
					method: "POST",
					url: "/auth/login",
					payload: { username: "admin", password: ADMIN_PASSWORD },
				})
			).statusCode,
		).toBe(401);
		await login(app, "admin", "nouveau-mot-de-passe");
	});

	it("creates personal tokens: value shown once, stored hashed, usable as Bearer on the API and on MCP", async () => {
		const { app } = await start();
		const admin = await login(app);
		const created = await call(app, {
			method: "POST",
			url: "/api/account/tokens",
			headers: admin,
			payload: { name: "Claude Code" },
		});
		const { token, id } = created.json<CreatedApiToken>();
		expect(token).toMatch(/^aq_[0-9a-f]{16}_[\w-]{40,}$/);
		expect(token.split("_")[1]).toBe(id);

		const listed = await call(app, { method: "GET", url: "/api/account/tokens", headers: admin });
		expect(listed.json()).toEqual([expect.objectContaining({ id, name: "Claude Code" })]);
		expect(listed.body).not.toContain(token);
		const rows = await app
			.get(MikroORM)
			.em.getConnection()
			.execute<{ token_hash: string }[]>("SELECT token_hash FROM api_tokens");
		// Only the SHA-256 hash (base64url) of the whole key is stored.
		expect(rows.map((row: { token_hash: string }) => row.token_hash)).toEqual([
			createHash("sha256").update(token).digest("base64url"),
		]);

		// A personal token only works for MCP: neither the UI API, nor account or token management.
		for (const url of ["/api/sessions", "/api/account/tokens", "/api/admin/users", "/auth/me"]) {
			expect((await call(app, { method: "GET", url, headers: bearer(token) })).statusCode, url).toBe(401);
		}
		const mcp = await call(app, {
			method: "POST",
			url: "/mcp",
			headers: { ...MCP_HEADERS, ...bearer(token) },
			payload: INITIALIZE,
		});
		expect(mcp.statusCode).toBe(200);
		expect(mcp.body).toContain("serverInfo");
		const anonymous = await call(app, { method: "POST", url: "/mcp", headers: MCP_HEADERS, payload: INITIALIZE });
		expect(anonymous.statusCode).toBe(401);

		expect(
			(await call(app, { method: "DELETE", url: `/api/account/tokens/${id}`, headers: admin })).statusCode,
		).toBe(200);
		const afterRevoke = await call(app, {
			method: "POST",
			url: "/mcp",
			headers: { ...MCP_HEADERS, ...bearer(token) },
			payload: INITIALIZE,
		});
		expect(afterRevoke.statusCode).toBe(401);
		expect(
			(await call(app, { method: "DELETE", url: `/api/account/tokens/${id}`, headers: admin })).statusCode,
		).toBe(404);
	});

	it("no UI route accepts an API token, whether the token is valid or not", async () => {
		const { app } = await start();
		const admin = await login(app);
		const created = await call(app, {
			method: "POST",
			url: "/api/account/tokens",
			headers: admin,
			payload: { name: "Claude Code" },
		});
		const { token } = created.json<CreatedApiToken>();
		const routes = [
			["GET", "/auth/me"],
			["GET", "/api/sessions"],
			["GET", "/api/sessions/history"],
			["GET", "/api/events"],
			["GET", "/api/account/tokens"],
			["POST", "/api/account/tokens"],
			["POST", "/api/account/password"],
			["GET", "/api/admin/users"],
			["POST", "/api/admin/users"],
			["GET", "/api/admin/sessions"],
		] as const;
		for (const [method, url] of routes) {
			expect((await call(app, { method, url, headers: bearer(token) })).statusCode, `${method} ${url}`).toBe(401);
		}
	});

	it("rejects malformed tokens or tokens of another scheme", async () => {
		const { app } = await start();
		for (const authorization of ["Bearer pas-un-jeton", "Bearer aq_inconnu", "Basic YWRtaW46c2VjcmV0", "Bearer"]) {
			const response = await call(app, { method: "GET", url: "/api/sessions", headers: { authorization } });
			expect(response.statusCode, authorization).toBe(401);
		}
	});

	it("does not let a user revoke another user's token", async () => {
		const { app } = await start();
		const admin = await login(app);
		const { headers: bob } = await createMember(app, admin);
		const id = (
			await call(app, { method: "POST", url: "/api/account/tokens", headers: admin, payload: { name: "à moi" } })
		).json<CreatedApiToken>().id;
		expect((await call(app, { method: "DELETE", url: `/api/account/tokens/${id}`, headers: bob })).statusCode).toBe(
			404,
		);
		expect(
			(await call(app, { method: "GET", url: "/api/account/tokens", headers: admin })).json<unknown[]>(),
		).toHaveLength(1);
	});
});

describe("session isolation between users", () => {
	it("partitions the API, the history and MCP by owner", async () => {
		const { app } = await start();
		const admin = await login(app);
		const { headers: bob } = await createMember(app, admin);
		const sessions = app.get(SessionsService);
		const adminId = (await call(app, { method: "GET", url: "/auth/me", headers: admin })).json<AuthMe>().userId;
		const secret = (
			await sessions.findOrCreate(adminId, { title: "Secret de l'admin", questions: [textQuestion()] })
		).session;

		// Bob sees it neither in his list nor by id, and can neither answer nor decline (404, not 403).
		const list = await call(app, { method: "GET", url: "/api/sessions", headers: bob });
		expect(list.json()).toEqual([]);
		expect(list.body).not.toContain("Secret");
		for (const [method, url] of [
			["GET", `/api/sessions/${secret.id}`],
			["PUT", `/api/sessions/${secret.id}/draft`],
			["POST", `/api/sessions/${secret.id}/answers`],
			["POST", `/api/sessions/${secret.id}/decline`],
		] as const) {
			const response = await call(app, { method, url, headers: bob, payload: {} });
			expect(response.statusCode, `${method} ${url}`).toBe(404);
		}
		expect((await sessions.get(adminId, secret.id))?.status).toBe("pending");

		// A member has no access to supervision.
		expect((await call(app, { method: "GET", url: "/api/admin/sessions", headers: bob })).statusCode).toBe(403);
		expect(
			(await call(app, { method: "GET", url: `/api/admin/sessions/${secret.id}`, headers: bob })).statusCode,
		).toBe(403);

		// The admin, on the other hand, still sees it.
		const mine = await call(app, { method: "GET", url: `/api/sessions/${secret.id}`, headers: admin });
		expect(mine.statusCode).toBe(200);
	});
});

describe("MCP-side isolation", () => {
	it("a member can neither read, modify nor resume another user's session with their token", async () => {
		const { app } = await start();
		const admin = await login(app);
		const { headers: bob } = await createMember(app, admin);
		const adminId = (await call(app, { method: "GET", url: "/auth/me", headers: admin })).json<AuthMe>().userId;
		const secret = (
			await app.get(SessionsService).findOrCreate(adminId, { title: "Secret", questions: [textQuestion()] })
		).session;
		const token = (
			await call(app, { method: "POST", url: "/api/account/tokens", headers: bob, payload: { name: "mcp" } })
		).json<CreatedApiToken>().token;

		const tool = async (name: string, args: Record<string, unknown>) => {
			const response = await call(app, {
				method: "POST",
				url: "/mcp",
				headers: { ...MCP_HEADERS, ...bearer(token) },
				payload: { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name, arguments: args } },
			});
			return response.body;
		};
		const questions = [textQuestion()];
		for (const body of [
			await tool("get_answers", { session_id: secret.id, wait_seconds: 0 }),
			await tool("update_questions", { session_id: secret.id, questions, wait_seconds: 0 }),
			await tool("ask_user", { session_id: secret.id, questions, wait_seconds: 0 }),
		]) {
			expect(body).toContain("session_id inconnu");
			expect(body).not.toContain("Secret");
		}
		expect((await app.get(SessionsService).get(adminId, secret.id))?.title).toBe("Secret");
	});
});

describe("supervision by an administrator", () => {
	it("sees every user's sessions read-only, without being able to answer them", async () => {
		const { app } = await start();
		const admin = await login(app);
		const { user, headers: bob } = await createMember(app, admin);
		const sessions = app.get(SessionsService);
		const theirs = (
			await sessions.findOrCreate(user.id, { title: "Questions de Bob", questions: [textQuestion()] })
		).session;

		const all = await call(app, { method: "GET", url: "/api/admin/sessions", headers: admin });
		expect(all.json<AdminSessionPage>().items).toEqual([
			expect.objectContaining({ id: theirs.id, ownerUsername: "bob", ownerId: user.id }),
		]);
		const one = await call(app, { method: "GET", url: `/api/admin/sessions/${theirs.id}`, headers: admin });
		expect(one.json<AdminSessionView>()).toMatchObject({ id: theirs.id, readOnly: true, ownerUsername: "bob" });

		// No writing on behalf of the owner: answer, decline and draft are not found for the admin.
		for (const [method, url] of [
			["PUT", `/api/sessions/${theirs.id}/draft`],
			["POST", `/api/sessions/${theirs.id}/answers`],
			["POST", `/api/sessions/${theirs.id}/decline`],
		] as const) {
			expect((await call(app, { method, url, headers: admin, payload: {} })).statusCode, url).toBe(404);
		}
		expect((await sessions.get(user.id, theirs.id))?.status).toBe("pending");

		// Bob, for his part, answers normally.
		const declined = await call(app, {
			method: "POST",
			url: `/api/sessions/${theirs.id}/decline`,
			headers: bob,
			payload: { reason: "non" },
		});
		expect(declined.statusCode).toBe(200);
	});
});

describe("account hardening", () => {
	it("also throttles attempts at the current password during a change (429)", async () => {
		const { app } = await start();
		const admin = await login(app);
		const attempt = () =>
			call(app, {
				method: "POST",
				url: "/api/account/password",
				headers: admin,
				payload: { current: "pas-le-bon-mot-de-passe", next: "nouveau-mot-de-passe" },
			});
		for (let i = 0; i < 10; i++) {
			expect((await attempt()).statusCode).toBe(403);
		}
		expect((await attempt()).statusCode).toBe(429);
	});

	it("does not let a burst of simultaneous sign-ins exceed the attempt limit", async () => {
		const { app } = await start();
		const responses = await Promise.all(
			Array.from({ length: 30 }, () =>
				call(app, {
					method: "POST",
					url: "/auth/login",
					payload: { username: "admin", password: "mauvais-mot-de-passe" },
				}),
			),
		);
		const codes = responses.map((response) => response.statusCode);
		expect(codes.filter((code) => code === 401)).toHaveLength(10);
		expect(codes.filter((code) => code === 429)).toHaveLength(20);
	});

	it("clears the cookie on sign-out even when the session has already expired", async () => {
		const { app } = await start();
		const response = await call(app, {
			method: "POST",
			url: "/auth/logout",
			headers: { cookie: "sid=expiree" },
		});
		expect(response.statusCode).toBe(200);
		expect(String(response.headers["set-cookie"])).toContain("Max-Age=0");
	});

	it("rejects an invalid pagination cursor (400) instead of returning the first page", async () => {
		const { app } = await start();
		const admin = await login(app);
		for (const url of [
			"/api/sessions/history?before=",
			"/api/sessions/history?before=abc",
			"/api/admin/sessions?before=-1",
			"/api/sessions/history?before=1000",
		]) {
			expect((await call(app, { method: "GET", url, headers: admin })).statusCode, url).toBe(400);
		}
		expect(
			(await call(app, { method: "GET", url: "/api/sessions/history?before=1000:abc", headers: admin }))
				.statusCode,
		).toBe(200);
	});

	it("shuts down without waiting for an open SSE stream or a pending MCP call", async () => {
		const { app } = await start();
		const admin = await login(app);
		await app.listen(0, "127.0.0.1");
		const port = (app.getHttpServer().address() as { port: number }).port;
		const status = await new Promise<number>((resolve) => {
			get(
				{ host: "127.0.0.1", port, path: "/api/events", headers: { ...HOST, cookie: admin.cookie } },
				(response) => resolve(response.statusCode ?? 0),
			);
		});
		expect(status).toBe(200);
		const started = Date.now();
		await app.close();
		apps = apps.filter((other) => other !== app);
		expect(Date.now() - started).toBeLessThan(5_000);
	});
});

describe("local profile", () => {
	it("works with no account or token, using the local user", async () => {
		const { app } = await start(testConfig());
		expect((await call(app, { method: "GET", url: "/api/sessions" })).statusCode).toBe(200);
		expect((await call(app, { method: "GET", url: "/auth/me" })).json<AuthMe>()).toMatchObject({
			mode: "local",
			userId: "local",
			role: "admin",
		});
	});

	it("does not expose account management", async () => {
		const { app } = await start(testConfig());
		for (const [method, url] of [
			["POST", "/auth/login"],
			["GET", "/api/admin/users"],
			["GET", "/api/account/tokens"],
			["GET", "/auth/invitations/x"],
		] as const) {
			const response = await call(app, {
				method,
				url,
				payload: method === "POST" ? { username: "a", password: "b" } : undefined,
			});
			expect(response.statusCode, `${method} ${url}`).toBe(404);
		}
	});
});
