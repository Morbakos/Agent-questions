import { existsSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acquireLock } from "@app/stdio/launcher-lock.js";

let dir: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "aq-lock-"));
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("acquireLock", () => {
	it("creates the lock and releases it", () => {
		const release = acquireLock(dir);
		expect(release).not.toBeNull();
		expect(existsSync(join(dir, "launcher.lock"))).toBe(true);
		release?.();
		expect(existsSync(join(dir, "launcher.lock"))).toBe(false);
	});

	it("lets only one of two concurrent launchers win", () => {
		const first = acquireLock(dir);
		expect(acquireLock(dir)).toBeNull();
		first?.();
		expect(acquireLock(dir)).not.toBeNull();
	});

	it("takes over a stale lock", () => {
		const file = join(dir, "launcher.lock");
		writeFileSync(file, "1");
		const old = new Date(Date.now() - 60_000);
		utimesSync(file, old, old);
		expect(acquireLock(dir)).not.toBeNull();
	});
});
