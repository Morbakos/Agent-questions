// Assemble l'artefact distribuable à la racine à partir des builds des workspaces.
// Le bundle serveur reste unique ; l'UI compilée est embarquée à côté.
import { cp, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const serverDist = fileURLToPath(new URL("../packages/server/dist/", import.meta.url));
const dist = fileURLToPath(new URL("../dist/", import.meta.url));

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await cp(new URL("index.js", `file://${serverDist}`), new URL("index.js", `file://${dist}`));
await cp(new URL("ui/", `file://${serverDist}`), new URL("ui/", `file://${dist}`), { recursive: true });
