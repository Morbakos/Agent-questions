import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { probeHealth, resolveTarget } from "@app/stdio/probe.js";

let server: Server | undefined;

async function serve(status: number, body: string, delayMs = 0): Promise<URL> {
	server = createServer((_request, response) => {
		setTimeout(() => response.writeHead(status, { "content-type": "application/json" }).end(body), delayMs);
	});
	await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
	return new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`);
}

afterEach(() => {
	server?.closeAllConnections();
	server?.close();
	server = undefined;
});

describe("probeHealth", () => {
	it("accepts a 200 with status ok", async () => {
		expect(await probeHealth(await serve(200, '{"status":"ok"}'))).toBe(true);
	});

	it("rejects a 503", async () => {
		expect(await probeHealth(await serve(503, '{"status":"error"}'))).toBe(false);
	});

	it("rejects an unexpected body", async () => {
		expect(await probeHealth(await serve(200, '{"hello":"world"}'))).toBe(false);
		expect(await probeHealth(await serve(200, "not json"))).toBe(false);
	});

	it("gives up after the timeout", async () => {
		expect(await probeHealth(await serve(200, '{"status":"ok"}', 500), 50)).toBe(false);
	});

	it("returns false when nothing listens", async () => {
		expect(await probeHealth(new URL("http://127.0.0.1:1/mcp"))).toBe(false);
	});
});

describe("resolveTarget", () => {
	it("defaults to the local server on 4317", () => {
		expect(resolveTarget({})).toEqual({ mcpUrl: new URL("http://127.0.0.1:4317/mcp"), local: true });
	});

	it("follows AQ_PORT", () => {
		expect(resolveTarget({ AQ_PORT: "5000" }).mcpUrl.href).toBe("http://127.0.0.1:5000/mcp");
	});

	it("never starts a server for a remote AQ_MCP_URL", () => {
		expect(resolveTarget({ AQ_MCP_URL: "https://aq.example.com/mcp" }).local).toBe(false);
		expect(resolveTarget({ AQ_MCP_URL: "http://localhost:9/mcp" }).local).toBe(true);
	});

	it("rejects invalid values", () => {
		expect(() => resolveTarget({ AQ_MCP_URL: "nope" })).toThrow("AQ_MCP_URL");
		expect(() => resolveTarget({ AQ_PORT: "0" })).toThrow("AQ_PORT");
	});
});
