import { describe, expect, it } from "vitest";
import { nestLogLevels } from "./log-levels.js";

describe("nestLogLevels", () => {
	it("enables Nest levels up to the AQ_LOG one", () => {
		expect(nestLogLevels("warn")).toEqual(["fatal", "error", "warn"]);
		expect(nestLogLevels("info")).toContain("log");
		expect(nestLogLevels("info")).not.toContain("debug");
		expect(nestLogLevels("trace")).toContain("verbose");
	});

	it("turns everything off for silent", () => {
		expect(nestLogLevels("silent")).toBe(false);
	});
});
