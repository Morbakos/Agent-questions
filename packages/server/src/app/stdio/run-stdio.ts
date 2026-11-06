import { runBridge } from "@app/stdio/bridge.js";
import { probeHealth, resolveTarget } from "@app/stdio/probe.js";
import { ensureServer } from "@app/stdio/spawn-server.js";

/**
 * `agent-questions --stdio`: attaches to the shared server (starting it if absent) and bridges stdio to `/mcp`.
 * Resolves with the process exit code; the caller exits.
 */
export async function runStdio(env: NodeJS.ProcessEnv = process.env): Promise<number> {
	try {
		const { mcpUrl, local } = resolveTarget(env);
		if (local) {
			await ensureServer(mcpUrl, env);
		} else if (!(await probeHealth(mcpUrl, 5000))) {
			throw new Error(`No Agent Questions server answers on ${mcpUrl.origin} (AQ_MCP_URL).`);
		}
		await runBridge({ mcpUrl, token: env.AQ_TOKEN || undefined });
		return 0;
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		return 1;
	}
}
