import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface AppConfig {
  /** Adresse d'écoute. 127.0.0.1 par défaut ; 0.0.0.0 dans Docker (publier le port sur 127.0.0.1 côté hôte). */
  host: string;
  port: number;
  /** URL de l'UI telle que l'utilisateur doit l'ouvrir dans son navigateur (sert aux liens renvoyés à l'agent). */
  baseUrl: string;
  /** Noms d'hôte supplémentaires acceptés dans l'en-tête Host (ex. le nom du service Docker). */
  allowedHosts: string[];
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
  const host = process.env.AQ_BIND_HOST ?? "127.0.0.1";
  const port = Number(process.env.AQ_PORT ?? 4317);
  const allowedHosts = (process.env.AQ_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean);
  const here = fileURLToPath(new URL(".", import.meta.url));
  const dataDir = process.env.AQ_DATA_DIR ?? join(homedir(), ".agent-questions");
  return {
    host,
    port,
    baseUrl: (process.env.AQ_PUBLIC_URL ?? `http://127.0.0.1:${port}`).replace(/\/+$/, ""),
    allowedHosts,
    dbFile: join(dataDir, "agent-questions.sqlite"),
    uiDir: process.env.AQ_UI_DIR ?? resolve(here, "../../ui/dist/ui/browser"),
    defaultWaitSeconds: Number(process.env.AQ_WAIT_SECONDS ?? 480),
    noOpen: process.env.AQ_NO_OPEN === "1",
    dev: process.env.AQ_DEV === "1",
  };
}
