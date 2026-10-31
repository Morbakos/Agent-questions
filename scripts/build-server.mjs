// Construit le bundle interne du workspace `@agent-questions/server` : un seul fichier `dist/index.js`
// (shared inliné, dépendances externes) et l'UI Angular copiée dans `dist/ui`.
// Échoue si l'UI n'est pas construite : un paquet sans UI serait inutilisable.
import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { cp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const server = (path) => fileURLToPath(new URL(`../packages/server/${path}`, import.meta.url));
const pkg = JSON.parse(readFileSync(server("package.json"), "utf8"));

// Le build de l'UI est exposé par l'`exports` de @agent-questions/ui : pas de chemin relatif vers l'autre paquet.
let uiSource;
try {
	uiSource = dirname(createRequire(import.meta.url).resolve("@agent-questions/ui/browser/index.html"));
} catch {
	console.error(
		"UI non construite : lancez `npm run build -w @agent-questions/ui` (ou `npm run build` à la racine).",
	);
	process.exit(1);
}

await rm(server("dist"), { recursive: true, force: true });

await build({
	entryPoints: [server("src/index.ts")],
	outfile: server("dist/index.js"),
	bundle: true,
	platform: "node",
	format: "esm",
	target: "node22",
	// Seules les dépendances de production restent externes ; @agent-questions/shared est inliné.
	external: Object.keys(pkg.dependencies),
	logLevel: "info",
	minify: true,
});

await cp(uiSource, server("dist/ui"), { recursive: true });
