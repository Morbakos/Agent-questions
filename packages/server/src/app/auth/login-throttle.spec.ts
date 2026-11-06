import { describe, expect, it } from "vitest";
import { LoginThrottle } from "./login-throttle.js";

describe("sign-in throttling", () => {
	const keys = ["user:alice", "ip:10.0.0.1"];

	it("blocks on the tenth failure, within the 15-minute window", () => {
		const throttle = new LoginThrottle();
		for (let i = 0; i < 10; i += 1) {
			throttle.check(keys, 1_000 + i);
			throttle.fail(keys, 1_000 + i);
		}
		expect(() => throttle.check(keys, 2_000)).toThrow(/Trop de tentatives/);
		expect(() => throttle.check(["user:bob", "ip:10.0.0.2"], 2_000)).not.toThrow();
		// Either key alone is enough to block (same address, different identifier).
		expect(() => throttle.check(["user:bob", "ip:10.0.0.1"], 2_000)).toThrow();
	});

	it("forgets failures after 15 minutes, and after a successful sign-in", () => {
		const throttle = new LoginThrottle();
		for (let i = 0; i < 10; i += 1) {
			throttle.fail(keys, 1_000);
		}
		expect(() => throttle.check(keys, 1_000 + 15 * 60_000)).not.toThrow();
		for (let i = 0; i < 10; i += 1) {
			throttle.fail(keys, 5_000);
		}
		throttle.succeed(keys);
		expect(() => throttle.check(keys, 5_001)).not.toThrow();
	});
});

describe("attempt and forgive", () => {
	it("counts the attempt before verification: a burst does not exceed the limit", () => {
		const throttle = new LoginThrottle();
		const keys = ["user:a", "ip:1"];
		let accepted = 0;
		for (let i = 0; i < 50; i++) {
			try {
				throttle.attempt(keys);
				accepted++;
			} catch {
				/* 429 */
			}
		}
		expect(accepted).toBe(10);
	});

	it("a success clears the identifier and only removes its own attempt from the address", () => {
		const throttle = new LoginThrottle();
		for (let i = 0; i < 5; i++) {
			throttle.fail(["ip:1"]); // failures on other accounts from the same address
		}
		throttle.attempt(["user:a", "ip:1"]);
		throttle.forgive("user:a", "ip:1");
		for (let i = 0; i < 4; i++) {
			throttle.attempt(["ip:1"]); // 5 + 4 = 9: there is some headroom left, but the first 5 failures were not erased
		}
		expect(() => throttle.attempt(["ip:1"])).not.toThrow(); // 10th attempt
		expect(() => throttle.attempt(["ip:1"])).toThrow(); // 11th: the 5 original failures are still counted
	});
});
