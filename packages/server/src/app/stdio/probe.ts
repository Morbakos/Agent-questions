import { isLoopbackHost } from "@app/config/config.js";

const DEFAULT_PORT = 4317;

export interface McpTarget {
	/** Full URL of the `/mcp` endpoint. */
	mcpUrl: URL;
	/** Whether the launcher may start a local server (never for a remote `AQ_MCP_URL`). */
	local: boolean;
}

/** `AQ_MCP_URL` when set, otherwise the local server on `AQ_PORT` (4317 by default). */
export function resolveTarget(env: NodeJS.ProcessEnv = process.env): McpTarget {
	if (env.AQ_MCP_URL) {
		let mcpUrl: URL;
		try {
			mcpUrl = new URL(env.AQ_MCP_URL);
		} catch {
			throw new Error("AQ_MCP_URL is not a valid URL.");
		}
		return { mcpUrl, local: isLoopbackHost(mcpUrl.hostname.toLowerCase()) };
	}
	const port = Number(env.AQ_PORT ?? DEFAULT_PORT);
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		throw new Error("AQ_PORT must be a valid TCP port (1-65535).");
	}
	return { mcpUrl: new URL(`http://127.0.0.1:${port}/mcp`), local: true };
}

/** `GET <origin>/health`: alive when it answers 200 with `{ "status": "ok" }`. Never throws. */
export async function probeHealth({ origin }: URL, timeoutMs = 1000): Promise<boolean> {
	try {
		const response = await fetch(`${origin}/health`, { signal: AbortSignal.timeout(timeoutMs) });
		if (response.status !== 200) {
			return false;
		}
		const body = (await response.json()) as { status?: unknown };
		return body.status === "ok";
	} catch {
		return false;
	}
}

/** Polls `probeHealth` until the server answers or `timeoutMs` elapses. */
export async function waitForHealth(
	url: URL,
	{
		timeoutMs = 15_000,
		intervalMs = 150,
		abort,
	}: { timeoutMs?: number; intervalMs?: number; abort?: () => boolean } = {},
): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (await probeHealth(url)) {
			return true;
		}
		if (abort?.()) {
			return probeHealth(url);
		}
		await new Promise((resolve) => setTimeout(resolve, intervalMs));
	}
	return false;
}
