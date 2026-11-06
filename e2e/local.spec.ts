import { expect, test } from "@playwright/test";
import { QUESTIONS, type RunningServer, callTool, startServer } from "./harness";

let server: RunningServer;

test.beforeEach(async () => {
	server = await startServer();
});
test.afterEach(async () => server.stop());

test("the UI renders with its styles and CSP, without console errors", async ({ page }) => {
	const problems: string[] = [];
	page.on("console", (message) => {
		if (message.type() === "error") {
			problems.push(message.text());
		}
	});
	page.on("pageerror", (error) => problems.push(error.message));

	const response = await page.goto(server.url);
	expect(response?.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
	await expect(page.getByRole("heading", { name: "Questions en attente" })).toBeVisible();

	// If the CSP blocked the deferred loading of the stylesheet, it would stay at `media="print"`.
	const media = await page.locator('link[rel="stylesheet"]').first().getAttribute("media");
	expect(media === null || media === "all").toBe(true);
	const fontFamily = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
	expect(fontFamily).not.toBe("Times New Roman");
	expect(problems).toEqual([]);
});

test("end to end: the agent asks a question, the user answers in the UI, the agent receives the answer", async ({
	page,
}) => {
	// The agent calls ask_user and waits (blocking call, like a real MCP client).
	const agent = callTool(server, "ask_user", { title: "Choix de la base", questions: QUESTIONS, wait_seconds: 40 });

	// The tab follows the agent: it lands on the form by itself (announcement replayed to the connecting tab).
	await page.goto(server.url);
	await expect(page.getByRole("heading", { name: "Choix de la base" })).toBeVisible();
	await expect(page.getByText("base de données")).toBeVisible();
	await expect(page.getByText("(facultatif)")).toBeVisible();

	// The send button stays disabled while a required answer is missing.
	const send = page.getByRole("button", { name: "Envoyer à l'agent" });
	await expect(send).toBeDisabled();
	await page.getByRole("radio", { name: "PostgreSQL" }).check();
	// The choice question also offers an "Autre" field (by default): we target the free-text question.
	await page.locator("app-question", { hasText: "Pourquoi ?" }).getByRole("textbox").fill("pour les extensions");
	await expect(send).toBeEnabled();
	await send.click();

	const result = await agent;
	expect(result.isError).toBe(false);
	expect(result.json).toMatchObject({
		status: "answered",
		answers: [
			{ question_id: "base", selected: [{ id: "postgres", label: "PostgreSQL" }] },
			{ question_id: "pourquoi", text: "pour les extensions" },
		],
	});
});

test("the user adds a note to a chosen option, and the agent receives the note with the option", async ({ page }) => {
	const agent = callTool(server, "ask_user", { title: "Avec précision", questions: QUESTIONS, wait_seconds: 40 });
	await page.goto(server.url);
	await expect(page.getByRole("heading", { name: "Avec précision" })).toBeVisible();

	const question = page.locator("app-question", { hasText: "base de données" });
	// No note field is offered until the option is checked.
	await expect(question.getByRole("button", { name: "Ajouter une précision" })).toHaveCount(0);
	await question.getByRole("radio", { name: "PostgreSQL" }).check();
	await question.getByRole("button", { name: "Ajouter une précision" }).click();
	await question.getByRole("textbox", { name: "Précision sur PostgreSQL" }).fill("version 16 minimum");
	await page.locator("app-question", { hasText: "Pourquoi ?" }).getByRole("textbox").fill("extensions");
	await page.getByRole("button", { name: "Envoyer à l'agent" }).click();

	const result = await agent;
	expect(result.json).toMatchObject({
		status: "answered",
		answers: [{ question_id: "base", selected: [{ id: "postgres", note: "version 16 minimum" }] }, {}],
	});
});

test("the user can decline to answer, and the agent knows it", async ({ page }) => {
	const agent = callTool(server, "ask_user", { title: "À refuser", questions: QUESTIONS, wait_seconds: 40 });
	await page.goto(server.url);
	await expect(page.getByRole("heading", { name: "À refuser" })).toBeVisible();
	await page.getByRole("button", { name: "Ne pas répondre" }).click();
	await page.getByLabel(/Pourquoi ne pas répondre/).fill("pas maintenant");
	await page.getByRole("button", { name: "Confirmer le refus" }).click();
	expect((await agent).json).toMatchObject({ status: "declined", reason: "pas maintenant" });
});

test("an open tab follows the agent: new questions arrive without reloading", async ({ page }) => {
	await page.goto(server.url);
	await expect(page.getByRole("heading", { name: "Questions en attente" })).toBeVisible();
	void callTool(server, "ask_user", { title: "Arrivée en direct", questions: QUESTIONS, wait_seconds: 5 }).catch(
		() => undefined,
	);
	await expect(page).toHaveURL(/\/s\/[0-9a-f-]{36}$/);
	await expect(page.getByRole("heading", { name: "Arrivée en direct" })).toBeVisible();
});

test("a late answer can be retrieved with get_answers", async ({ page }) => {
	const first = await callTool(server, "ask_user", { title: "Tardive", questions: QUESTIONS, wait_seconds: 1 });
	expect(first.json).toMatchObject({ status: "pending" });
	const sessionId = String(first.json?.["session_id"]);

	await page.goto(`${server.url}/s/${sessionId}`);
	await page.getByRole("radio", { name: "SQLite" }).check();
	await page.getByRole("button", { name: "Envoyer à l'agent" }).click();

	const later = await callTool(server, "get_answers", { session_id: sessionId, wait_seconds: 0 });
	expect(later.json).toMatchObject({ status: "answered" });
	expect((later.json?.["answers"] as { selected: { id: string }[] }[])[0]?.selected).toEqual([
		{ id: "sqlite", label: "SQLite" },
	]);
});

test("markdown content coming from the agent is sanitized (no script, no remote image)", async ({ page }) => {
	const dialogs: string[] = [];
	page.on("dialog", (dialog) => {
		dialogs.push(dialog.message());
		void dialog.dismiss();
	});
	const requested: string[] = [];
	page.on("request", (request) => requested.push(request.url()));
	const hostile = [
		{
			id: "x",
			prompt: '<img src="https://tracker.example/pixel.png" onerror="alert(1)"> ![p](https://tracker.example/p2.png) <script>alert(2)</script>[clic](javascript:alert(3))',
			type: "text",
		},
	];
	void callTool(server, "ask_user", { title: "Hostile", questions: hostile, wait_seconds: 3 }).catch(() => undefined);
	await page.goto(server.url);
	await expect(page.getByRole("heading", { name: "Hostile" })).toBeVisible();
	await page.waitForTimeout(500);
	expect(dialogs).toEqual([]);
	expect(requested.filter((url) => url.includes("tracker.example"))).toEqual([]);
});

test("the API rejects foreign origins and unknown routes answer in JSON", async () => {
	const foreign = await fetch(`${server.url}/api/sessions`, { headers: { origin: "http://evil.example" } });
	expect(foreign.status).toBe(403);
	const unknown = await fetch(`${server.url}/api/nope`);
	expect(unknown.status).toBe(404);
	expect(await unknown.json()).toEqual({ error: "Route introuvable" });
});
