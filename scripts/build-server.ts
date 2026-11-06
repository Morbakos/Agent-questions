// Builds the distributable `dist/` artifact: a single server bundle (`dist/index.js`) and the Angular UI (`dist/ui`).
// The root package's `dependencies` stay external (installed by users); `@agent-questions/shared`, shipped as
// TypeScript, is inlined. Nest does not need `emitDecoratorMetadata`: every injection is explicit.
import { cp, readFile, rm, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dependencies, version } from "../package.json" with { type: "json" };

const uiBuild = new URL("../packages/ui/dist/ui/browser/", import.meta.url);
const dist = new URL("../dist/", import.meta.url);

// A package without a UI would be unusable: fail rather than publish.
if (!(await stat(new URL("index.html", uiBuild)).catch(() => null))) {
	console.error("UI not built: run `bun run build` at the repository root.");
	process.exit(1);
}

await rm(dist, { recursive: true, force: true });

const result = await Bun.build({
	entrypoints: [fileURLToPath(new URL("../packages/server/src/main.ts", import.meta.url))],
	outdir: fileURLToPath(dist),
	naming: "index.js",
	target: "node",
	format: "esm",
	external: Object.keys(dependencies),
	// Only the version of package.json ends up in the bundle (see `packages/server/src/app/version.ts`).
	define: { __APP_VERSION__: JSON.stringify(version) },
	// Production artifact: no source map (it would ship the original sources) and minified whitespace and syntax.
	// Identifiers are NOT mangled: Nest and MikroORM derive provider and entity names from class names.
	sourcemap: "none",
	minify: { whitespace: true, syntax: true, identifiers: false },
});
if (!result.success) {
	for (const log of result.logs) {
		console.error(log);
	}
	process.exit(1);
}

// The `@app/…` and `@server/…` aliases must have been resolved by Bun.build: an alias left in the bundle would crash
// at startup (Cannot find package). Fail here if a Bun update stopped reading `paths`.
const bundle = await readFile(new URL("index.js", dist), "utf8");
if (/from\s*"@(app|server)\//.test(bundle)) {
	console.error(
		"The bundle contains unresolved aliases (@app/ or @server/): check `paths` in packages/server/tsconfig.json.",
	);
	process.exit(1);
}

// The version must have been injected (otherwise the server would announce the development fallback value), and
// nothing else from package.json (scripts, devDependencies) may remain in the bundle.
if (bundle.includes("0.0.0-dev") || !bundle.includes(JSON.stringify(version)) || bundle.includes('"devDependencies"')) {
	console.error("The version was not injected correctly into the bundle (see `define` above).");
	process.exit(1);
}

// The server's CSP only allows inline JavaScript by hash: Angular must have built the UI with `security.autoCsp`
// (CSP <meta> tag in index.html), otherwise the inline critical CSS (`onload=`) would be blocked and the UI would
// render unstyled.
const html = await readFile(new URL("index.html", uiBuild), "utf8");
const hasInlineScript = /\sonload=|<script(?![^>]*\ssrc=)[^>]*>/i.test(html);
if (hasInlineScript && !/http-equiv="Content-Security-Policy"/i.test(html)) {
	console.error(
		"index.html contient du JavaScript inline sans CSP par empreinte : activez `security.autoCsp` (Angular).",
	);
	process.exit(1);
}

await cp(uiBuild, new URL("ui/", dist), { recursive: true });
console.log("Build done: dist/index.js and dist/ui.");
