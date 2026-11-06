// Smoke test of the published package: installs the tarball like a user would, starts the installed server and checks
// /health, the UI and MCP initialization. The server must run on Node and on Bun (both provide node:sqlite).
// Usage: bun scripts/verify-package.ts <tarball> [node|bun]   (node by default)
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";

const tarball = process.argv[2];
if (!tarball) throw new Error("Usage: bun scripts/verify-package.ts <package.tgz> [node|bun]");
const runtime = process.argv[3] ?? "node";
if (runtime !== "node" && runtime !== "bun") throw new Error(`Unknown runtime: ${runtime}`);

const tempDir = await mkdtemp(join(tmpdir(), "agent-questions-package-"));
const port = 43800 + (process.pid % 1000);
const packageDir = join(tempDir, "node_modules", "@morbakos", "agent-questions");
let server: ChildProcess | undefined;

function run(command: string, args: string[], cwd: string) {
	const result = spawnSync(command, args, { cwd, stdio: "inherit" });
	if (result.error) throw result.error;
	if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed (${result.status})`);
}

try {
	await writeFile(join(tempDir, "package.json"), '{"private":true,"type":"module"}');
	run(process.execPath, ["add", "--cwd", tempDir, tarball], tempDir); // process.execPath: this same Bun

	const entry = join(packageDir, "dist", "index.js");
	await Promise.all([
		access(entry),
		access(join(packageDir, "dist", "ui", "index.html")),
		access(join(packageDir, "README.md")),
		access(join(packageDir, "LICENSE")),
	]);

	const env = {
		...process.env,
		AQ_BIND_HOST: "127.0.0.1",
		AQ_PORT: String(port),
		AQ_DATA_DIR: join(tempDir, "data"),
		AQ_NO_OPEN: "1",
	};
	server = spawn(runtime, [entry], { cwd: tempDir, env, stdio: "inherit" });
	const baseUrl = `http://127.0.0.1:${port}`;
	const deadline = Date.now() + 20_000;
	let healthy = false;
	while (Date.now() < deadline) {
		if (server.exitCode !== null) throw new Error(`Installed package exited with ${server.exitCode}`);
		try {
			const response = await fetch(baseUrl + "/health");
			if (response.ok) {
				healthy = true;
				break;
			}
		} catch {
			/* Wait for startup. */
		}
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	if (!healthy) throw new Error("The installed package did not become healthy.");
	const ui = await fetch(baseUrl + "/");
	if (!ui.ok || !(await ui.text()).toLowerCase().includes("<html")) {
		throw new Error("The installed package did not serve its Angular UI.");
	}

	// Exercise the current SDK's legacy stateless compatibility path, which keeps older MCP clients working.
	const initialize = await fetch(baseUrl + "/mcp", {
		method: "POST",
		headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
		body: JSON.stringify({
			jsonrpc: "2.0",
			id: 1,
			method: "initialize",
			params: {
				protocolVersion: "2025-11-25",
				capabilities: {},
				clientInfo: { name: "package-smoke-test", version: "0.0.0" },
			},
		}),
	});
	const text = await initialize.text();
	const data = text
		.split(/\r?\n/)
		.filter((line) => line.startsWith("data:"))
		.map((line) => line.slice(5).trim())
		.join("\n");
	const message = JSON.parse(data || text);
	if (!initialize.ok || !message.result?.serverInfo?.name) {
		throw new Error("The installed package did not initialize its MCP HTTP endpoint.");
	}
	const installed = JSON.parse(await readFile(join(packageDir, "package.json"), "utf8")) as { version: string };
	if (message.result.serverInfo.version !== installed.version) {
		throw new Error(
			`MCP serverInfo.version is "${message.result.serverInfo.version}", the package version is "${installed.version}".`,
		);
	}
	// The stdio launcher of the installed package attaches to the running server and bridges `initialize`.
	const bridged = await new Promise<string>((resolve, reject) => {
		const launcher = spawn(runtime, [entry, "--stdio"], { cwd: tempDir, env, stdio: ["pipe", "pipe", "inherit"] });
		const timer = setTimeout(() => {
			launcher.kill();
			reject(new Error("The stdio launcher did not answer initialize."));
		}, 20_000);
		let out = "";
		launcher.stdout.on("data", (chunk: Buffer) => {
			out += chunk.toString();
			if (out.includes("\n")) {
				clearTimeout(timer);
				launcher.kill();
				resolve(out.split("\n")[0] ?? "");
			}
		});
		launcher.stdin.write(
			JSON.stringify({
				jsonrpc: "2.0",
				id: 1,
				method: "initialize",
				params: {
					protocolVersion: "2025-11-25",
					capabilities: {},
					clientInfo: { name: "package-smoke-test", version: "0.0.0" },
				},
			}) + "\n",
		);
	});
	if (!JSON.parse(bridged).result?.serverInfo?.name) {
		throw new Error("The stdio launcher of the installed package did not bridge MCP initialize.");
	}
	// A production package ships no source map (it would expose the original sources).
	if (
		await access(join(packageDir, "dist", "index.js.map")).then(
			() => true,
			() => false,
		)
	) {
		throw new Error("The package contains dist/index.js.map: source maps must not be published.");
	}
	console.log(`Package tarball smoke test passed on ${runtime}: HTTP health, Angular UI and MCP initialize.`);
} finally {
	if (server && server.exitCode === null) {
		const running = server;
		if (process.platform === "win32" && running.pid) {
			// A version manager shim (nvm) launches the real Node as a child process: kill the whole tree.
			spawnSync("taskkill", ["/PID", String(running.pid), "/T", "/F"], { stdio: "ignore" });
		} else {
			running.kill();
		}
		await Promise.race([
			new Promise((resolve) => running.once("exit", resolve)),
			new Promise((resolve) => setTimeout(resolve, 5_000)),
		]);
	}
	// On Windows, the server's files (SQLite, node_modules) can stay locked for a short while.
	await rm(tempDir, { recursive: true, force: true, maxRetries: 40, retryDelay: 250 });
}
