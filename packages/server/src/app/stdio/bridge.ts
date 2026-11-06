import {
	StreamableHTTPClientTransport,
	isJSONRPCResultResponse,
	type JSONRPCMessage,
} from "@modelcontextprotocol/client";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";

/**
 * Relays JSON-RPC messages between this process's stdin/stdout and the Streamable HTTP endpoint, unchanged.
 * Resolves when stdin closes or the HTTP side fails. Stdout carries the protocol only.
 */
export async function runBridge({ mcpUrl, token }: { mcpUrl: URL; token?: string }): Promise<void> {
	const stdio = new StdioServerTransport();
	const http = new StreamableHTTPClientTransport(mcpUrl, {
		requestInit: token ? { headers: { Authorization: `Bearer ${token}` } } : undefined,
	});

	let closed = false;
	let done!: () => void;
	const finished = new Promise<void>((resolve) => (done = resolve));
	const shutdown = async () => {
		if (closed) {
			return;
		}
		closed = true;
		await Promise.allSettled([http.close(), stdio.close()]);
		done();
	};

	const initializeIds = new Set<string | number>();
	const fail = (error: Error) => console.error(`Agent Questions (stdio): ${error.message}`);

	stdio.onmessage = (message: JSONRPCMessage) => {
		if ("method" in message && message.method === "initialize" && "id" in message) {
			initializeIds.add(message.id);
		}
		http.send(message).catch((error: Error) => {
			fail(error);
			if ("method" in message && "id" in message) {
				stdio
					.send({ jsonrpc: "2.0", id: message.id, error: { code: -32603, message: error.message } })
					.catch(fail);
			}
		});
	};
	http.onmessage = (message: JSONRPCMessage) => {
		if (isJSONRPCResultResponse(message) && initializeIds.delete(message.id)) {
			const { protocolVersion } = message.result as { protocolVersion?: string };
			if (protocolVersion) {
				http.setProtocolVersion(protocolVersion);
			}
		}
		stdio.send(message).catch(fail);
	};
	http.onerror = fail;
	stdio.onerror = fail;
	stdio.onclose = () => void shutdown();

	process.once("SIGTERM", () => void shutdown());
	process.once("SIGINT", () => void shutdown());

	await http.start();
	await stdio.start();
	await finished;
}
