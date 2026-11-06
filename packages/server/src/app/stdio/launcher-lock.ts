import { mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const LOCK_STALE_MS = 30_000;

/**
 * Takes `<dataDir>/launcher.lock` (created with the `wx` flag). Returns a release function, or `null` when another
 * launcher holds a fresh lock. A lock older than `staleMs` is considered abandoned and taken over.
 */
export function acquireLock(dataDir: string, staleMs = LOCK_STALE_MS): (() => void) | null {
	mkdirSync(dataDir, { recursive: true });
	const file = join(dataDir, "launcher.lock");
	for (let attempt = 0; attempt < 2; attempt++) {
		try {
			writeFileSync(file, String(process.pid), { flag: "wx" });
			return () => rmSync(file, { force: true });
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
				throw error;
			}
			try {
				if (Date.now() - statSync(file).mtimeMs <= staleMs) {
					return null;
				}
				rmSync(file, { force: true });
			} catch {
				/* the holder released it in the meantime: retry */
			}
		}
	}
	return null;
}
