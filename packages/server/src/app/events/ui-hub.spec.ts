import type { MessageEvent } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UiHub } from "./ui-hub.js";

const session = { id: "s1", title: "Mon titre" };
const announcement = { type: "new-session", data: { sessionId: "s1", title: "Mon titre" } };

const U = "u1";

let hub: UiHub;

beforeEach(() => {
	vi.useFakeTimers();
	hub = new UiHub();
});

afterEach(() => vi.useRealTimers());

/** A tab: subscribes to the stream of `owner` and keeps what it receives. */
function open(owner = U, sessionKey: string | null = null, expiresAt?: Date) {
	const events: MessageEvent[] = [];
	let closed = false;
	const subscription = hub.stream(owner, sessionKey, expiresAt).subscribe({
		next: (event) => events.push(event),
		complete: () => (closed = true),
	});
	return {
		events,
		announcements: () => events.filter(({ type }) => type === "new-session"),
		isClosed: () => closed,
		/** The client drops the connection. */
		disconnect: () => subscription.unsubscribe(),
	};
}

describe("stream", () => {
	it("announces the connection with a comment, then a keep-alive comment every 15 s", () => {
		const tab = open();
		expect(tab.events).toEqual([{ comment: "connecté" }]);
		vi.advanceTimersByTime(15_000);
		expect(tab.events.at(-1)).toEqual({ comment: "keepalive" });
	});

	it("closes when the sign-in session expires", () => {
		const tab = open(U, "k1", new Date(Date.now() + 60_000));
		vi.advanceTimersByTime(59_000);
		expect(tab.isClosed()).toBe(false);
		vi.advanceTimersByTime(1_000);
		expect(tab.isClosed()).toBe(true);
		expect(hub.hasUi(U)).toBe(false);
	});

	it("closes immediately when the sign-in session has already expired", () => {
		const tab = open(U, "k1", new Date(Date.now() - 1));
		vi.advanceTimersByTime(0);
		expect(tab.isClosed()).toBe(true);
	});

	it("stops sending keep-alives after the client disconnects", () => {
		const tab = open();
		tab.disconnect();
		const before = tab.events.length;
		vi.advanceTimersByTime(60_000);
		expect(tab.events).toHaveLength(before);
	});

	it("closes every stream before the server shuts down", () => {
		const a = open();
		const b = open("u2");
		hub.beforeApplicationShutdown();
		expect([a.isClosed(), b.isClosed()]).toEqual([true, true]);
	});
});

describe("hasUi", () => {
	it("is false with no connected tab and no recent opening", () => {
		expect(hub.hasUi(U)).toBe(false);
	});

	it("is true while a tab is connected, and false after it closes", () => {
		const tab = open();
		vi.advanceTimersByTime(10 * 60_000);
		expect(hub.hasUi(U)).toBe(true);
		tab.disconnect();
		expect(hub.hasUi(U)).toBe(false);
	});

	it("counts a tab that was just opened, while it connects", () => {
		hub.markOpened(U);
		expect(hub.hasUi(U)).toBe(true);
		vi.advanceTimersByTime(16_000);
		expect(hub.hasUi(U)).toBe(false);
	});
});

describe("announce", () => {
	it("announces the session (id and title) to every connected tab", () => {
		const a = open();
		const b = open();
		hub.announce(U, session);
		expect(a.announcements()).toEqual([announcement]);
		expect(b.announcements()).toEqual([announcement]);
	});

	it("no longer writes to a closed tab", () => {
		const tab = open();
		tab.disconnect();
		hub.announce(U, session);
		expect(tab.announcements()).toEqual([]);
	});

	it("replays a recent announcement to a tab that connects right after", () => {
		hub.announce(U, session);
		expect(open().announcements()).toEqual([announcement]);
	});

	it("does not replay an old announcement", () => {
		hub.announce(U, session);
		vi.advanceTimersByTime(11_000);
		expect(open().announcements()).toEqual([]);
	});
});

describe("per-user partitioning", () => {
	it("announces a session only to the tabs of its owner", () => {
		const mine = open();
		const theirs = open("u2");
		hub.announce(U, session);
		expect(mine.announcements()).toEqual([announcement]);
		expect(theirs.announcements()).toEqual([]);
		expect(hub.hasUi("u2")).toBe(true);
		expect(hub.hasUi("u3")).toBe(false);
	});

	it("does not replay one user's announcement to another user's tab", () => {
		hub.announce(U, session);
		expect(open("u2").announcements()).toEqual([]);
	});

	it("closeUser closes the user's streams, closeSession closes that of a single sign-in", () => {
		const a = open(U, "k1");
		const b = open(U, "k2");
		hub.closeSession("k1");
		expect([a.isClosed(), b.isClosed()]).toEqual([true, false]);
		expect(hub.hasUi(U)).toBe(true);
		hub.closeUser(U);
		expect(b.isClosed()).toBe(true);
		expect(hub.hasUi(U)).toBe(false);
	});

	it("closeUser spares the given session (password change)", () => {
		const current = open(U, "k1");
		const other = open(U, "k2");
		hub.closeUser(U, "k1");
		expect([current.isClosed(), other.isClosed()]).toEqual([false, true]);
	});
});
