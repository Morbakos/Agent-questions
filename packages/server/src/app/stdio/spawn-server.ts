import { spawn } from "node:child_process";
import { closeSync, openSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveDataDir } from "@app/config/config.js";
import { acquireLock } from "@app/stdio/launcher-lock.js";
import { probeHealth, waitForHealth } from "@app/stdio/probe.js";

/** Last lines of the server log, for the error shown when the server does not come up. */
function logTail(logFile: string, lines = 15): string {
	try {
		return readFileSync(logFile, "utf8").trimEnd().split("\n").slice(-lines).join("\n");
	} catch {
		return "(log unreadable)";
	}
}

/**
 * Makes sure a server answers on `url`: attaches to a running one, or starts a detached one (this very bundle,
 * without the `--stdio` argument) and waits for it. Only one launcher starts it, the others wait on the probe.
 * The server outlives the launcher, which never stops it.
 */
export async function ensureServer(url: URL, env: NodeJS.ProcessEnv = process.env): Promise<void> {
	if (await probeHealth(url)) {
		return;
	}
	const dataDir = resolveDataDir(env);
	const logFile = join(dataDir, "server.log");
	const release = acquireLock(dataDir);
	let exited = false;
	if (release) {
		try {
			if (await probeHealth(url)) {
				return;
			}
			const logFd = openSync(logFile, "a");
			try {
				const child = spawn(process.execPath, [fileURLToPath(import.meta.url)], {
					detached: true,
					stdio: ["ignore", logFd, logFd],
					windowsHide: true,
					env,
				});
				child.once("exit", () => (exited = true));
				child.once("error", () => (exited = true));
				child.unref();
			} finally {
				closeSync(logFd);
			}
		} catch (error) {
			release();
			throw error;
		}
	}
	try {
		if (await waitForHealth(url, { abort: () => exited })) {
			return;
		}
	} finally {
		release?.();
	}
	throw new Error(`The Agent Questions server did not start on ${url.origin}.\nLog: ${logFile}\n${logTail(logFile)}`);
}
