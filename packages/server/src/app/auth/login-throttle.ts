import { HttpError } from "@app/http/http-error.js";

const WINDOW_MS = 15 * 60_000;
const MAX_FAILURES = 10;
const MAX_KEYS = 10_000;

/**
 * Limits failed sign-in attempts per username and per address (sliding window, in memory):
 * beyond 10 failures in 15 minutes, sign-in is refused (429) even with the right password.
 */
export class LoginThrottle {
	private failures = new Map<string, number[]>();

	private recent(key: string, now: number): number[] {
		const kept = (this.failures.get(key) ?? []).filter((at) => now - at < WINDOW_MS);
		if (kept.length) {
			this.failures.set(key, kept);
		} else {
			this.failures.delete(key);
		}
		return kept;
	}

	/** Throws 429 if either key (username, address) has failed too often. */
	check(keys: string[], now = Date.now()): void {
		if (keys.some((key) => this.recent(key, now).length >= MAX_FAILURES)) {
			throw new HttpError(429, "Trop de tentatives de connexion. Réessayez dans quelques minutes.");
		}
	}

	/** Records one failure (timestamp `now`, in ms) on each key; keeps at most `MAX_KEYS` keys, evicting the oldest inserted. */
	fail(keys: string[], now = Date.now()): void {
		for (const key of keys) {
			this.failures.set(key, [...this.recent(key, now), now]);
		}
		while (this.failures.size > MAX_KEYS) {
			const oldest = this.failures.keys().next().value;
			if (oldest === undefined) {
				break;
			}
			this.failures.delete(oldest);
		}
	}

	/**
	 * Checks then **immediately records** an attempt (synchronously, before any await): concurrent requests in a
	 * burst therefore cannot all pass `check` before the first failure is noted.
	 */
	attempt(keys: string[], now = Date.now()): void {
		this.check(keys, now);
		this.fail(keys, now);
	}

	/** After a success: clears the username, and removes from the address only the attempt just recorded. */
	forgive(userKey: string, ipKey: string): void {
		this.failures.delete(userKey);
		const attempts = this.failures.get(ipKey);
		attempts?.pop();
		if (attempts?.length === 0) {
			this.failures.delete(ipKey);
		}
	}

	/** Clears the failures of all the given keys (unlike `forgive`, which spares the address history). */
	succeed(keys: string[]): void {
		for (const key of keys) {
			this.failures.delete(key);
		}
	}
}
