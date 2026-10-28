import { spawn } from "node:child_process";
import { mkdirSync, openSync } from "node:fs";
import http from "node:http";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import type { AppConfig } from "./config.js";

/**
 * Mode `--stdio` : le client MCP (Claude Code, Codex…) lance ce processus et lui parle sur stdin/stdout.
 * Il ne contient aucune logique : il s'assure qu'un démon HTTP tourne (UI, API, base SQLite, attente des
 * réponses) et relaie chaque message JSON-RPC vers son endpoint `/mcp`. L'attente reste ainsi dans le démon,
 * qui est le seul à connaître l'UI : plusieurs agents partagent la même UI et les mêmes sessions.
 *
 * Règle d'or : stdout ne doit contenir que du JSON-RPC. Tous les journaux vont sur stderr.
 */

type JsonRpcId = string | number | null;
interface JsonRpcMessage {
	jsonrpc?: string;
	id?: JsonRpcId;
	method?: string;
	params?: { requestId?: unknown };
}

const log = (...args: unknown[]) => console.error("[agent-questions stdio]", ...args);
const send = (msg: unknown) => process.stdout.write(`${JSON.stringify(msg)}\n`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function healthy(port: number, timeoutMs = 800): Promise<boolean> {
	return new Promise((resolve) => {
		const req = http.get({ host: "127.0.0.1", port, path: "/health", timeout: timeoutMs }, (res) => {
			res.resume();
			resolve(res.statusCode === 200);
		});
		req.on("timeout", () => {
			req.destroy();
			resolve(false);
		});
		req.on("error", () => resolve(false));
	});
}

/** Démarre le démon HTTP (processus détaché, survit à l'agent) s'il ne répond pas déjà. */
async function ensureDaemon(cfg: AppConfig, entry: string): Promise<void> {
	if (await healthy(cfg.port)) return;
	const dataDir = dirname(cfg.dbFile);
	mkdirSync(dataDir, { recursive: true });
	const logFile = join(dataDir, "daemon.log");
	const logFd = openSync(logFile, "a");
	const child = spawn(process.execPath, [...process.execArgv, entry], {
		detached: true,
		stdio: ["ignore", logFd, logFd],
		windowsHide: true,
		env: process.env,
	});
	child.on("error", (e) => log("échec du démarrage du serveur HTTP :", e.message));
	child.unref();
	log(`serveur HTTP démarré (pid ${child.pid}), journal : ${logFile}`);
	const deadline = Date.now() + 15_000;
	while (Date.now() < deadline) {
		if (await healthy(cfg.port, 500)) return;
		await sleep(200);
	}
	throw new Error(`le serveur HTTP ne répond pas sur le port ${cfg.port} (voir ${logFile})`);
}

class HttpFailure extends Error {
	constructor(
		readonly status: number,
		body: string,
	) {
		super(`HTTP ${status} : ${body.slice(0, 300)}`);
	}
}

/** Émet chaque message JSON-RPC contenu dans un événement SSE ou un corps JSON. */
function emit(text: string): void {
	if (!text.trim()) return;
	try {
		const value: unknown = JSON.parse(text);
		for (const m of Array.isArray(value) ? value : [value]) send(m);
	} catch {
		log("message ignoré (JSON invalide) :", text.slice(0, 200));
	}
}

/** Extrait le message JSON d'un événement SSE (lignes `data:` concaténées). */
function sseData(rawEvent: string): string {
	return rawEvent
		.split(/\r?\n/)
		.filter((l) => l.startsWith("data:"))
		.map((l) => l.slice(5).replace(/^ /, ""))
		.join("\n");
}

function relayOnce(
	cfg: AppConfig,
	msg: JsonRpcMessage,
	inflight: Map<string, http.ClientRequest>,
	key: string | null,
): Promise<void> {
	return new Promise((resolve, reject) => {
		const payload = JSON.stringify(msg);
		// Pas de timeout : un appel ask_user peut légitimement attendre plusieurs minutes une réponse humaine.
		const req = http.request(
			{
				host: "127.0.0.1",
				port: cfg.port,
				path: "/mcp",
				method: "POST",
				headers: {
					"content-type": "application/json",
					accept: "application/json, text/event-stream",
					"content-length": Buffer.byteLength(payload),
				},
			},
			(res) => {
				const status = res.statusCode ?? 0;
				const type = String(res.headers["content-type"] ?? "");
				res.setEncoding("utf8");
				let buffer = "";
				res.on("data", (chunk: string) => {
					buffer += chunk;
					if (status >= 400 || !type.includes("text/event-stream")) return;
					// Un événement SSE se termine par une ligne vide ; ses lignes `data:` forment un message JSON.
					let sep: number;
					while ((sep = buffer.search(/\r?\n\r?\n/)) !== -1) {
						const rawEvent = buffer.slice(0, sep);
						buffer = buffer.slice(sep).replace(/^\r?\n\r?\n/, "");
						emit(sseData(rawEvent));
					}
				});
				res.on("end", () => {
					if (status >= 400) return reject(new HttpFailure(status, buffer));
					if (status !== 202) emit(type.includes("text/event-stream") ? sseData(buffer) : buffer);
					resolve();
				});
				res.on("error", reject);
				res.on("aborted", () => reject(new Error("réponse interrompue")));
			},
		);
		req.on("error", reject);
		if (key !== null) inflight.set(key, req);
		req.on("close", () => {
			if (key !== null) inflight.delete(key);
		});
		req.end(payload);
	});
}

const isRefused = (e: unknown) => (e as NodeJS.ErrnoException)?.code === "ECONNREFUSED";

export async function runStdio(cfg: AppConfig, entry: string): Promise<void> {
	const inflight = new Map<string, http.ClientRequest>();
	const cancelled = new Set<string>();

	let ready: Promise<void> | null = null;
	const ensure = () =>
		(ready ??= ensureDaemon(cfg, entry).catch((e) => {
			ready = null;
			throw e;
		}));
	void ensure().catch((e: Error) => log(e.message)); // démarre sans attendre le premier message

	async function relay(msg: JsonRpcMessage): Promise<void> {
		const hasId = msg.id !== undefined && msg.id !== null;
		const isRequest = hasId && msg.method !== undefined;
		const key = hasId ? String(msg.id) : null;
		try {
			await ensure();
			try {
				await relayOnce(cfg, msg, inflight, key);
			} catch (e) {
				if (!isRefused(e)) throw e;
				ready = null; // le démon est tombé entre-temps : on le relance une fois
				await ensure();
				await relayOnce(cfg, msg, inflight, key);
			}
		} catch (e) {
			if (key !== null && cancelled.delete(key)) return; // annulé par le client : pas de réponse attendue
			const message = e instanceof Error ? e.message : String(e);
			if (isRequest)
				send({ jsonrpc: "2.0", id: msg.id, error: { code: -32000, message: `Agent Questions : ${message}` } });
			else log(message);
		}
	}

	const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
	rl.on("line", (line) => {
		if (!line.trim()) return;
		let msg: JsonRpcMessage;
		try {
			msg = JSON.parse(line) as JsonRpcMessage;
		} catch {
			send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
			return;
		}
		if (msg.method === "notifications/cancelled") {
			// Le serveur MCP est sans état : on abandonne la requête HTTP, ce qui interrompt l'attente côté démon.
			const target = String(msg.params?.requestId);
			cancelled.add(target);
			inflight.get(target)?.destroy();
			return;
		}
		void relay(msg);
	});
	rl.on("close", () => {
		for (const req of inflight.values()) req.destroy();
		process.exit(0);
	});
	for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => process.exit(0));
}
