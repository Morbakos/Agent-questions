#!/usr/bin/env node
import "reflect-metadata";
import { ConfigError, loadConfig } from "@app/config/config.js";

function readConfig() {
	try {
		return loadConfig();
	} catch (error) {
		if (error instanceof ConfigError) {
			console.error(`Invalid configuration: ${error.message}`);
			process.exit(1);
		}
		throw error;
	}
}

const config = readConfig();

const { createApplication } = await import("@app/application.js");
const app = await createApplication({ config });
app.enableShutdownHooks();
await app.listen(config.port, config.host);

console.log(`
Agent Questions ready (${config.deploymentMode} profile).
  UI        ${config.baseUrl}
  MCP       ${config.baseUrl}/mcp (MCP Streamable HTTP)
  Database  ${config.dbFile}

Listening on ${config.host}:${config.port}
Claude Code : claude mcp add --transport http agent-questions http://127.0.0.1:${config.port}/mcp
`);
