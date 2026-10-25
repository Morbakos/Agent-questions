import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface AppConfig {
  host: string;
  port: number;
  baseUrl: string;
  dbFile: string;
  uiDir: string;
  /** Durée d'attente par défaut d'un appel d'outil avant de répondre « pending ». */
  defaultWaitSeconds: number;
  /** N'ouvre pas le navigateur automatiquement. */
  noOpen: boolean;
  /** Autorise l'origine du serveur de dev Angular (localhost:4200). */
  dev: boolean;
}

export function loadConfig(): AppConfig {
  const host = "127.0.0.1"; // volontairement non configurable : serveur local uniquement
  const port = Number(process.env.AQ_PORT ?? 4317);
  const here = fileURLToPath(new URL(".", import.meta.url));
  const dataDir = process.env.AQ_DATA_DIR ?? join(homedir(), ".agent-questions");
  return {
    host,
    port,
    baseUrl: `http://${host}:${port}`,
    dbFile: join(dataDir, "agent-questions.sqlite"),
    uiDir: process.env.AQ_UI_DIR ?? resolve(here, "../../ui/dist/ui/browser"),
    defaultWaitSeconds: Number(process.env.AQ_WAIT_SECONDS ?? 480),
    noOpen: process.env.AQ_NO_OPEN === "1",
    dev: process.env.AQ_DEV === "1",
  };
}
