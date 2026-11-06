import { type Browser, type BrowserContext, type Page, expect, test } from "@playwright/test";
import { QUESTIONS, type RunningServer, callTool, startServer } from "./harness";

const ADMIN_PASSWORD = "mot-de-passe-admin-e2e";
const BOB_PASSWORD = "mot-de-passe-bob-e2e";

let server: RunningServer;

test.beforeEach(async () => {
	server = await startServer({
		AQ_DEPLOYMENT_MODE: "server",
		AQ_ADMIN_USERNAME: "admin",
		AQ_ADMIN_PASSWORD: ADMIN_PASSWORD,
	});
});
test.afterEach(async () => server.stop());

async function loginAs(page: Page, username: string, password: string): Promise<void> {
	await page.goto(`${server.url}/login`);
	await page.getByLabel("Identifiant").fill(username);
	await page.getByLabel("Mot de passe").fill(password);
	await page.getByRole("button", { name: "Se connecter" }).click();
	await expect(page.getByRole("heading", { name: "Questions en attente" })).toBeVisible();
}

/** Creates a personal token for the user signed in on this page (like the "Mon compte" page does). */
async function createToken(page: Page): Promise<string> {
	const response = await page.request.post(`${server.url}/api/account/tokens`, { data: { name: "e2e" } });
	expect(response.ok()).toBe(true);
	return ((await response.json()) as { token: string }).token;
}

/** The administrator invites "bob" in the UI; bob opens the link in his own browser and chooses his password. */
async function inviteBob(adminPage: Page, browser: Browser): Promise<{ page: Page; context: BrowserContext }> {
	await adminPage.getByRole("link", { name: "Utilisateurs" }).click();
	await adminPage.getByLabel("Identifiant").fill("bob");
	await adminPage.getByRole("button", { name: "Créer et inviter" }).click();
	const link = (await adminPage.locator(".secret").textContent())?.trim() ?? "";
	expect(link).toContain("/invite/");

	const context = await browser.newContext();
	const page = await context.newPage();
	await page.goto(link.replace(/^https?:\/\/[^/]+/, server.url));
	await page.getByLabel("Mot de passe", { exact: true }).fill(BOB_PASSWORD);
	await page.getByLabel("Confirmation").fill(BOB_PASSWORD);
	await page.getByRole("button", { name: "Créer mon accès" }).click();
	await expect(page.getByRole("heading", { name: "Questions en attente" })).toBeVisible();
	return { page, context };
}

test("anonymous: the API and MCP require authentication, /health stays public", async ({ page }) => {
	expect((await fetch(`${server.url}/health`)).status).toBe(200);
	expect((await fetch(`${server.url}/api/sessions`)).status).toBe(401);
	expect((await fetch(`${server.url}/api/events`)).status).toBe(401);
	expect((await fetch(`${server.url}/mcp`, { method: "POST" })).status).toBe(401);
	// Without a session, the UI redirects to the sign-in page.
	await page.goto(server.url);
	await expect(page).toHaveURL(/\/login/);
	await expect(page.getByRole("heading", { name: "Connexion" })).toBeVisible();
});

test("a bad sign-in is refused with a message, then the right one works", async ({ page }) => {
	await page.goto(`${server.url}/login`);
	await page.getByLabel("Identifiant").fill("admin");
	await page.getByLabel("Mot de passe").fill("pas-le-bon-mot-de-passe");
	await page.getByRole("button", { name: "Se connecter" }).click();
	await expect(page.getByRole("alert")).toContainText("incorrect");
	await loginAs(page, "admin", ADMIN_PASSWORD);
});

test("several users: each one only sees their own questions, the admin supervises read-only", async ({
	page,
	browser,
}) => {
	await loginAs(page, "admin", ADMIN_PASSWORD);
	const { page: bobPage, context: bobContext } = await inviteBob(page, browser);
	const adminToken = await createToken(page);
	const bobToken = await createToken(bobPage);

	// The admin's agent and Bob's agent each ask their own question.
	const adminAsk = await callTool(
		server,
		"ask_user",
		{ title: "Secret de l'admin", questions: QUESTIONS, wait_seconds: 1 },
		adminToken,
	);
	const adminSessionId = String(adminAsk.json?.["session_id"]);
	// Bob does not see the admin's session, neither in his list nor by opening it by its id.
	await bobPage.goto(server.url);
	await expect(bobPage.getByRole("heading", { name: "Questions en attente" })).toBeVisible();
	await expect(bobPage.getByText("Secret de l'admin")).toHaveCount(0);
	await bobPage.goto(`${server.url}/s/${adminSessionId}`);
	await expect(bobPage.getByRole("heading", { name: "Session introuvable" })).toBeVisible();

	// Then Bob's agent asks his question: Bob's tab is taken there, and only his.
	const bobAgent = callTool(
		server,
		"ask_user",
		{ title: "Question de Bob", questions: QUESTIONS, wait_seconds: 40 },
		bobToken,
	);
	bobAgent.catch(() => undefined);
	await expect(bobPage.getByRole("heading", { name: "Question de Bob" })).toBeVisible();

	// His agent cannot read the admin's session either.
	const probe = await callTool(server, "get_answers", { session_id: adminSessionId, wait_seconds: 0 }, bobToken);
	expect(probe.isError).toBe(true);
	expect(probe.text).toContain("session_id inconnu");
	expect(probe.text).not.toContain("Secret");

	// The admin sees both in the supervision view, read-only.
	await page.getByRole("link", { name: "Sessions" }).click();
	const bobRow = page.getByRole("row", { name: /Question de Bob/ });
	await expect(bobRow).toContainText("bob");
	await expect(page.getByRole("row", { name: /Secret de l'admin/ })).toContainText("admin");
	await bobRow.getByRole("link").click();
	await expect(page.getByText("Lecture seule")).toBeVisible();
	await expect(page.getByRole("button")).toHaveCount(
		await page.getByRole("button", { name: "Se déconnecter" }).count(),
	);
	await expect(page.getByRole("button", { name: "Envoyer à l'agent" })).toHaveCount(0);

	// The admin cannot answer in Bob's place (even by forcing the call).
	const bobSessionId = page.url().split("/").pop();
	for (const action of ["answers", "decline"]) {
		const forced = await page.request.post(`${server.url}/api/sessions/${bobSessionId}/${action}`, { data: {} });
		expect(forced.status(), action).toBe(404);
	}

	// Bob answers normally, and his agent receives the answer.
	await bobPage.goto(`${server.url}/s/${bobSessionId}`);
	await bobPage.getByRole("radio", { name: "SQLite" }).check();
	await bobPage.getByRole("button", { name: "Envoyer à l'agent" }).click();
	expect((await bobAgent).json).toMatchObject({ status: "answered" });

	await bobContext.close();
});

test("a personal token only works for MCP: it opens neither the UI API nor the administration", async ({ page }) => {
	await loginAs(page, "admin", ADMIN_PASSWORD);
	const token = await createToken(page);
	for (const path of ["/api/sessions", "/api/account/tokens", "/api/admin/users", "/api/admin/sessions"]) {
		const response = await fetch(`${server.url}${path}`, { headers: { authorization: `Bearer ${token}` } });
		expect(response.status, path).toBe(401);
	}
	expect(
		(await callTool(server, "get_answers", { session_id: "00000000-0000-4000-8000-000000000000" }, token)).isError,
	).toBe(true);
});

test("a member cannot access the administration", async ({ page, browser }) => {
	await loginAs(page, "admin", ADMIN_PASSWORD);
	const { page: bobPage, context } = await inviteBob(page, browser);
	await expect(bobPage.getByRole("link", { name: "Utilisateurs" })).toHaveCount(0);
	await bobPage.goto(`${server.url}/admin/users`);
	await expect(bobPage).toHaveURL(`${server.url}/`);
	expect((await bobPage.request.get(`${server.url}/api/admin/users`)).status()).toBe(403);
	expect((await bobPage.request.get(`${server.url}/api/admin/sessions`)).status()).toBe(403);
	await context.close();
});

test("signing out closes the session", async ({ page }) => {
	await loginAs(page, "admin", ADMIN_PASSWORD);
	await page.getByRole("button", { name: "Se déconnecter" }).click();
	await expect(page).toHaveURL(/\/login/);
	expect((await page.request.get(`${server.url}/api/sessions`)).status()).toBe(401);
});

test("after the session expires, signing in brings back the requested page", async ({ page }) => {
	await loginAs(page, "admin", ADMIN_PASSWORD);
	await page.context().clearCookies();
	await page.goto(`${server.url}/admin/sessions`);
	await expect(page).toHaveURL(/\/login/);
});
