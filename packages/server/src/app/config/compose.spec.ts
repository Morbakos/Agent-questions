import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const compose = readFileSync(new URL("../../../../../docker-compose.yml", import.meta.url), "utf8");

describe("docker-compose.yml (local profile)", () => {
	it("publishes each port on the host loopback, never on all interfaces", () => {
		const published = [...compose.matchAll(/^\s*-\s*"?([^"\s]+:\d+:\d+)"?\s*$/gm)].map((match) => match[1]);
		expect(published.length).toBeGreaterThan(0);
		for (const mapping of published) {
			expect(mapping, mapping).toMatch(/^127\.0\.0\.1:/);
		}
	});
});
