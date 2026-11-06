import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { QUESTIONS, type RunningServer, startServer } from "./harness";

const INSPECTOR = fileURLToPath(
	new URL("../node_modules/@modelcontextprotocol/inspector/clients/launcher/build/index.js", import.meta.url),
);

interface InspectorRun {
	done: Promise<{ code: number | null; stdout: string; stderr: string }>;
}

/** Runs the MCP Inspector CLI (`--cli`) against `/mcp`: a third-party MCP client sharing nothing with our code. */
function inspector({ url }: Pick<RunningServer, "url">, method: string, toolArgs: string[] = []): InspectorRun {
	const args = [INSPECTOR, "--cli", `${url}/mcp`, "--transport", "http", "--method", method, ...toolArgs];
	const child = spawn(process.execPath, args, { stdio: ["ignore", "pipe", "pipe"] });
	let stdout = "";
	let stderr = "";
	child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
	child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
	return { done: new Promise((resolve) => child.on("close", (code) => resolve({ code, stdout, stderr }))) };
}

const toolCall = (name: string, args: Record<string, unknown>): string[] => [
	"--tool-name",
	name,
	"--tool-arg",
	...Object.entries(args).map(
		([key, value]) => `${key}=${typeof value === "string" ? value : JSON.stringify(value)}`,
	),
];

const toolResult = (stdout: string): { isError?: boolean; json: Record<string, unknown> } => {
	const { content, isError } = JSON.parse(stdout) as { content: { text: string }[]; isError?: boolean };
	return { isError, json: JSON.parse(content[0]?.text ?? "{}") as Record<string, unknown> };
};

let server: RunningServer;

test.beforeEach(async () => {
	server = await startServer();
});
test.afterEach(async () => server.stop());

test("MCP Inspector lists the three tools with their schemas", async () => {
	const { code, stdout, stderr } = await inspector(server, "tools/list").done;
	expect(code, stderr).toBe(0);
	const { tools } = JSON.parse(stdout) as { tools: { name: string; inputSchema: { required?: string[] } }[] };
	expect(tools.map(({ name }) => name).sort()).toEqual(["ask_user", "get_answers", "update_questions"]);
	expect(tools.find(({ name }) => name === "ask_user")?.inputSchema.required).toEqual(["questions"]);
});

test("end to end with MCP Inspector: ask_user waits, the UI's answer wakes the call", async () => {
	const agent = inspector(
		server,
		"tools/call",
		toolCall("ask_user", { title: "Via Inspector", questions: QUESTIONS, wait_seconds: 40 }),
	);

	// The question shows up in the UI's API: answer it the way the form would.
	let sessionId = "";
	await expect
		.poll(async () => {
			const list = (await (await fetch(`${server.url}/api/sessions`)).json()) as { id: string }[];
			sessionId = list[0]?.id ?? "";
			return sessionId;
		})
		.not.toBe("");
	const answered = await fetch(`${server.url}/api/sessions/${sessionId}/answers`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			base: { selected: ["postgres"], text: "" },
			pourquoi: { selected: [], text: "extensions" },
		}),
	});
	expect(answered.status).toBe(200);

	const { code, stdout, stderr } = await agent.done;
	expect(code, stderr).toBe(0);
	const { isError, json } = toolResult(stdout);
	expect(isError).toBeFalsy();
	expect(json).toMatchObject({
		status: "answered",
		answers: [
			{ question_id: "base", selected: [{ id: "postgres", label: "PostgreSQL" }] },
			{ question_id: "pourquoi", text: "extensions" },
		],
	});
});

test('MCP Inspector: an unanswered call returns "pending", get_answers resumes the same session', async () => {
	const first = await inspector(
		server,
		"tools/call",
		toolCall("ask_user", { title: "Sans réponse", questions: QUESTIONS, wait_seconds: 1 }),
	).done;
	expect(first.code, first.stderr).toBe(0);
	const pending = toolResult(first.stdout).json;
	expect(pending).toMatchObject({ status: "pending" });

	const again = await inspector(
		server,
		"tools/call",
		toolCall("get_answers", { session_id: pending["session_id"], wait_seconds: 1 }),
	).done;
	expect(toolResult(again.stdout).json).toMatchObject({ status: "pending", session_id: pending["session_id"] });
});
