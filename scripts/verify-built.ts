// Local check of the built package: packs the repository (after `bun run build`) then replays verify-package.ts on
// Node and on Bun, like the CI. Catches errors that only show up at startup (missing export, etc.).
// Usage: bun scripts/verify-built.ts
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

function run(args: string[]) {
	const result = spawnSync(process.execPath, args, { stdio: "inherit" });
	if (result.error) throw result.error;
	if (result.status !== 0) throw new Error(`bun ${args.join(" ")} failed (${result.status})`);
}

const dir = await mkdtemp(join(tmpdir(), "agent-questions-pack-"));
try {
	run(["pm", "pack", "--destination", dir]);
	const tarball = (await readdir(dir)).find((file) => file.endsWith(".tgz"));
	if (!tarball) throw new Error("No tarball produced");
	for (const runtime of ["node", "bun"]) run(["scripts/verify-package.ts", join(dir, tarball), runtime]);
} finally {
	await rm(dir, { recursive: true, force: true });
}
