import { describe, expect, it } from "vitest";
import { formatCursor } from "@app/sessions/domain/session-cursor.js";
import { parseCursor } from "./cursor.js";
import { HttpError } from "./http-error.js";

describe("parseCursor", () => {
	it("returns undefined when the cursor is absent", () => {
		expect(parseCursor(undefined)).toBeUndefined();
	});

	it("parses `<ms>:<id>` and round-trips with formatCursor", () => {
		const cursor = { at: 1700000000000, id: "0b7e2c1a-4f3d-4c55-9a11-123456789abc" };
		expect(parseCursor(formatCursor(cursor))).toEqual(cursor);
	});

	it.each([
		"",
		"abc",
		"42",
		"42:",
		":abc",
		"-1:abc",
		"1.5:abc",
		"1:a b",
		"1:a:b",
		`1:${"x".repeat(65)}`,
		"12345678901234567:a",
	])("rejects %j with a 400", (value) => {
		expect(() => parseCursor(value)).toThrow(HttpError);
		try {
			parseCursor(value);
		} catch (error) {
			expect((error as HttpError).status).toBe(400);
		}
	});
});
