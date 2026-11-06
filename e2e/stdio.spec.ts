import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { expect, test } from "@playwright/test";
import { QUESTIONS, startServer } from "./harness";

const ENTRY = fileURLToPath(new URL("../dist/index.js", import.meta.url));

async function freePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const probe = createServer();
		probe.once("error", reject);
		probe.listen(0, "127.0.0.1", () => {
			const { port } = probe.address() as { port: number };
			probe.close(() => resolve(port));
		});
	});
}

/** Pid listening on `port` (the detached servers started by the launcher are not children of the test). */
function pidOnPort(port: number): number | undefined {
	if (process.platform === "win32") {
		const out = spawnSync("netstat", ["-ano", "-p", "tcp"], { encoding: "utf8" }).stdout;
		const line = out.split(/\r?\n/).find((l) => l.includes(`127.0.0.1:${port} `) && l.includes("LISTENING"));
		return line ? Number(line.trim().split(/\s+/).pop()) : undefined;
	}
	const out = spawnSync("lsof", ["-ti", `tcp:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" }).stdout.trim();
	return out ? Number(out.split("\n")[0]) : undefined;
}

async function healthy(port: number): Promise<boolean> {
	try {
		return (await fetch(`http://127.0.0.1:${port}/health`)).ok;
	} catch {
		return false;
	}
}

function textOf(result: { content?: unknown }): string {
	return (result.content as { text?: string }[] | undefined)?.[0]?.text ?? "";
}

interface Env {
	port: number;
	dataDir: string;
	env: Record<string, string>;
}

const cleanups: (() => Promise<void> | void)[] = [];
test.afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function freshEnv(): Promise<Env> {
	const port = await freePort();
	const dataDir = mkdtempSync(join(tmpdir(), "aq-stdio-"));
	const env = {
		...(process.env as Record<string, string>),
		AQ_PORT: String(port),
		AQ_DATA_DIR: dataDir,
		AQ_NO_OPEN: "1",
		AQ_LOG: "warn",
	};
	cleanups.push(async () => {
		const pid = pidOnPort(port);
		if (pid) {
			if (process.platform === "win32")
				spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
			else process.kill(pid);
		}
		for (let attempt = 0; attempt < 20; attempt++) {
			try {
				rmSync(dataDir, { recursive: true, force: true });
				return;
			} catch {
				await new Promise((resolve) => setTimeout(resolve, 250));
			}
		}
	});
	return { port, dataDir, env };
}

async function connect({ env }: Env): Promise<Client> {
	const client = new Client({ name: "stdio-e2e", version: "0.0.0" });
	await client.connect(new StdioClientTransport({ command: process.execPath, args: [ENTRY, "--stdio"], env }));
	cleanups.unshift(() => client.close());
	return client;
}

test("attaches to a server that is already running", async () => {
	const server = await startServer();
	cleanups.push(() => server.stop());
	const client = await connect({
		port: server.port,
		dataDir: server.dataDir,
		env: server.env as Record<string, string>,
	});
	const { tools } = await client.listTools();
	expect(tools.map((tool) => tool.name)).toContain("ask_user");
});

test("starts a detached server when none runs, which outlives the launcher and is reused", async () => {
	const ctx = await freshEnv();
	expect(await healthy(ctx.port)).toBe(false);

	const first = await connect(ctx);
	expect((await first.listTools()).tools.length).toBeGreaterThan(0);
	expect(await healthy(ctx.port)).toBe(true);
	expect(existsSync(join(ctx.dataDir, "server.log"))).toBe(true);
	const pid = pidOnPort(ctx.port);

	await first.close();
	await new Promise((resolve) => setTimeout(resolve, 500));
	expect(await healthy(ctx.port)).toBe(true);

	const second = await connect(ctx);
	expect((await second.listTools()).tools.length).toBeGreaterThan(0);
	expect(pidOnPort(ctx.port)).toBe(pid);
	expect(existsSync(join(ctx.dataDir, "agent-questions.sqlite"))).toBe(true);
});

test("two simultaneous launchers share a single server", async () => {
	const ctx = await freshEnv();
	const [a, b] = await Promise.all([connect(ctx), connect(ctx)]);
	await Promise.all([a.listTools(), b.listTools()]);
	expect(await healthy(ctx.port)).toBe(true);
	const first = pidOnPort(ctx.port);
	expect(first).toBeDefined();
	const created = await a.callTool({
		name: "ask_user",
		arguments: { title: "Partagé", questions: QUESTIONS },
	});
	const { session_id } = JSON.parse(textOf(created)) as { session_id: string };
	const seen = await b.callTool({ name: "get_answers", arguments: { session_id } });
	expect(seen.isError).toBeFalsy();
});

test("end to end over stdio: ask_user, answer through the API, get_answers", async () => {
	const ctx = await freshEnv();
	const client = await connect(ctx);
	const asked = await client.callTool({ name: "ask_user", arguments: { title: "Base", questions: QUESTIONS } });
	const { session_id } = JSON.parse(textOf(asked)) as { session_id: string };
	const answer = await fetch(`http://127.0.0.1:${ctx.port}/api/sessions/${session_id}/answers`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ base: { selected: ["sqlite"], text: "" } }),
	});
	expect(answer.ok).toBe(true);
	const result = await client.callTool({ name: "get_answers", arguments: { session_id } });
	expect(JSON.parse(textOf(result))).toMatchObject({ status: "answered" });
});

test("every line the launcher writes on stdout is a JSON-RPC message", async () => {
	const ctx = await freshEnv();
	const child = spawn(process.execPath, [ENTRY, "--stdio"], { env: ctx.env, stdio: ["pipe", "pipe", "ignore"] });
	cleanups.unshift(() => void child.kill());
	let out = "";
	child.stdout.on("data", (chunk: Buffer) => (out += chunk.toString()));
	child.stdin.write(
		JSON.stringify({
			jsonrpc: "2.0",
			id: 1,
			method: "initialize",
			params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "raw", version: "0" } },
		}) + "\n",
	);
	await expect.poll(() => out.includes('"id":1'), { timeout: 30_000 }).toBe(true);
	child.stdin.write(
		'{"jsonrpc":"2.0","method":"notifications/initialized"}\n{"jsonrpc":"2.0","id":2,"method":"tools/list"}\n',
	);
	await expect.poll(() => out.includes('"id":2'), { timeout: 10_000 }).toBe(true);
	const lines = out.split("\n").filter(Boolean);
	expect(lines.length).toBeGreaterThanOrEqual(2);
	for (const line of lines) {
		expect((JSON.parse(line) as { jsonrpc: string }).jsonrpc).toBe("2.0");
	}
});
