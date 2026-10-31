// Assemble l'artefact distribuable à la racine à partir des builds des workspaces.
// Le bundle serveur reste unique ; l'UI compilée est embarquée à côté.
import { readFileSync } from "node:fs";
import { cp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Les dépendances de production sont déclarées deux fois : dans le paquet racine (installées par les utilisateurs)
// et dans `packages/server` (laissées externes par le bundle). Refuser de publier si elles divergent.
const dependenciesOf = (url) => JSON.parse(readFileSync(new URL(url, import.meta.url), "utf8")).dependencies ?? {};
const rootDeps = JSON.stringify(Object.entries(dependenciesOf("../package.json")).sort());
const serverDeps = JSON.stringify(Object.entries(dependenciesOf("../packages/server/package.json")).sort());
if (rootDeps !== serverDeps) {
	console.error("Les `dependencies` de package.json et de packages/server/package.json doivent être identiques.");
	process.exit(1);
}

const serverDist = fileURLToPath(new URL("../packages/server/dist/", import.meta.url));
const dist = fileURLToPath(new URL("../dist/", import.meta.url));

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await cp(join(serverDist, "index.js"), join(dist, "index.js"));
await cp(join(serverDist, "ui"), join(dist, "ui"), { recursive: true });
