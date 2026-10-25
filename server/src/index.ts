import { loadConfig } from "./config.js";
import { buildApp } from "./http.js";
import { SessionStore } from "./sessions.js";

const cfg = loadConfig();
const store = new SessionStore(cfg.dbFile);
const app = await buildApp(store, cfg);

await app.listen({ host: cfg.host, port: cfg.port });

console.log(`
Agent Questions prêt.
  UI        ${cfg.baseUrl}
  MCP       ${cfg.baseUrl}/mcp   (Streamable HTTP)
  Base      ${cfg.dbFile}

Écoute sur ${cfg.host}:${cfg.port}
Claude Code : claude mcp add --transport http agent-questions http://127.0.0.1:${cfg.port}/mcp
`);
