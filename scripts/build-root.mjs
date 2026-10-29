// Assemble l'artefact distribuable à la racine à partir des builds des workspaces.
// Le bundle serveur reste unique ; l'UI compilée est embarquée à côté.
import { cp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const serverDist = fileURLToPath(new URL("../packages/server/dist/", import.meta.url));
const dist = fileURLToPath(new URL("../dist/", import.meta.url));

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await cp(join(serverDist, "index.js"), join(dist, "index.js"));
await cp(join(serverDist, "ui"), join(dist, "ui"), { recursive: true });
