import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveDataDir } from "@app/config/config.js";

describe("resolveDataDir", () => {
	it("defaults to ~/.agent-questions", () => {
		expect(resolveDataDir({})).toBe(join(homedir(), ".agent-questions"));
	});

	it("expands a leading ~", () => {
		expect(resolveDataDir({ AQ_DATA_DIR: "~/aq" })).toBe(join(homedir(), "aq"));
	});

	it("uses AQ_DATA_DIR as is otherwise", () => {
		expect(resolveDataDir({ AQ_DATA_DIR: "/data" })).toBe("/data");
	});
});
