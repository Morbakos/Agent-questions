import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ENTRY = fileURLToPath(new URL("../dist/index.js", import.meta.url));

export interface RunningServer {
	url: string;
	port: number;
	dataDir: string;
	env: NodeJS.ProcessEnv;
	log: () => string;
	stop: () => Promise<void>;
}

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

async function waitHealthy(url: string, child: ChildProcess, log: () => string): Promise<void> {
	const deadline = Date.now() + 30_000;
	while (Date.now() < deadline) {
		if (child.exitCode !== null) {
			throw new Error(`the server exited (code ${child.exitCode}):\n${log()}`);
		}
		try {
			if ((await fetch(`${url}/health`)).ok) {
				return;
			}
		} catch {
			/* not ready yet */
		}
		await new Promise((resolve) => setTimeout(resolve, 150));
	}
	throw new Error(`the server does not answer on ${url}:\n${log()}`);
}

/** Starts `dist/index.js` on a free port with a temporary database. `env` extends or overrides the configuration. */
export async function startServer(env: Record<string, string> = {}): Promise<RunningServer> {
	const port = await freePort();
	const dataDir = mkdtempSync(join(tmpdir(), "aq-e2e-"));
	const url = `http://127.0.0.1:${port}`;
	const fullEnv: NodeJS.ProcessEnv = {
		...process.env,
		AQ_PORT: String(port),
		AQ_DATA_DIR: dataDir,
		AQ_NO_OPEN: "1",
		AQ_LOG: "warn",
		AQ_PUBLIC_URL: url,
		...env,
	};
	const child = spawn(process.execPath, [ENTRY], { env: fullEnv, stdio: ["ignore", "pipe", "pipe"] });
	let output = "";
	child.stdout?.on("data", (chunk: Buffer) => (output += chunk.toString()));
	child.stderr?.on("data", (chunk: Buffer) => (output += chunk.toString()));
	const log = () => output;
	try {
		await waitHealthy(url, child, log);
	} catch (error) {
		child.kill();
		throw error;
	}
	return {
		url,
		port,
		dataDir,
		env: fullEnv,
		log,
		async stop() {
			if (child.exitCode === null) {
				child.kill();
				await new Promise((resolve) => child.once("exit", resolve));
			}
			// Windows keeps the SQLite file open for a moment after the process exits.
			for (let attempt = 0; attempt < 20; attempt++) {
				try {
					rmSync(dataDir, { recursive: true, force: true });
					return;
				} catch {
					await new Promise((resolve) => setTimeout(resolve, 250));
				}
			}
		},
	};
}

const MCP_HEADERS = { "content-type": "application/json", accept: "application/json, text/event-stream" };

/** Calls an MCP tool over HTTP (stateless: no initialization required). Returns the tool's JSON, or the error. */
export async function callTool(
	server: Pick<RunningServer, "url">,
	name: string,
	args: Record<string, unknown>,
	token?: string,
): Promise<{ isError: boolean; text: string; json: Record<string, unknown> | undefined }> {
	const response = await fetch(`${server.url}/mcp`, {
		method: "POST",
		headers: { ...MCP_HEADERS, ...(token ? { authorization: `Bearer ${token}` } : {}) },
		body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
	});
	const body = await response.text();
	const data = /^data: (.*)$/m.exec(body)?.[1] ?? body;
	const result = (JSON.parse(data) as { result?: { content: { text: string }[]; isError?: boolean } }).result;
	const text = result?.content[0]?.text ?? "";
	return {
		isError: result?.isError === true,
		text,
		json: result?.isError ? undefined : (JSON.parse(text) as Record<string, unknown>),
	};
}

export const QUESTIONS = [
	{
		id: "base",
		header: "Base",
		prompt: "Quelle **base de données** ?",
		type: "single",
		options: [
			{ id: "sqlite", label: "SQLite" },
			{ id: "postgres", label: "PostgreSQL" },
		],
	},
	{ id: "pourquoi", prompt: "Pourquoi ?", type: "text", required: false },
];
