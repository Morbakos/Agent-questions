import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { buildApp } from "./http.js";
import { SessionStore } from "./sessions.js";

const cfg = loadConfig();

if (process.argv.includes("--stdio")) {
  // Mode client MCP (Claude Code, Codex…) : relaie vers le serveur HTTP, qu'il démarre au besoin.
  // stdout est réservé au JSON-RPC : aucun console.log ici.
  const { runStdio } = await import("./stdio.js");
  await runStdio(cfg, fileURLToPath(import.meta.url));
} else {
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
En stdio    : claude mcp add agent-questions -- node ${fileURLToPath(import.meta.url)} --stdio
`);
}
