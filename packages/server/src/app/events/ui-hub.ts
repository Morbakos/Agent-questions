import type { BeforeApplicationShutdown, MessageEvent } from "@nestjs/common";
import { Observable, type Subscriber } from "rxjs";
import type { UiNewSessionEvent } from "@agent-questions/shared";

/** How long a just-opened tab (not yet connected) counts as open. */
const OPEN_GRACE_MS = 15_000;
/** A recent announcement is replayed to a tab that connects right after. */
const REPLAY_MS = 10_000;
const KEEPALIVE_MS = 15_000;
/** `setTimeout` caps at 2^31-1 ms: beyond that, it fires immediately. */
const MAX_TIMER_MS = 2 ** 31 - 1;

/** One open SSE connection (one browser tab). The hub keys its state by user id (`owner`); durations are in ms. */
interface Client {
	subscriber: Subscriber<MessageEvent>;
	/** Identity of the connection (hash of the cookie or token): lets us close the stream of one specific session. */
	sessionKey: string | null;
}

const toMessage = (event: UiNewSessionEvent): MessageEvent => ({ type: "new-session", data: event });

/**
 * Connected UI tabs (the `/api/events` SSE stream, Nest's `@Sse()`: each tab is an `Observable`), **partitioned by
 * user**: an announcement is sent only to its owner's tabs, and nothing else (no title, no id) flows to the others.
 * Also used to open only one browser tab per user.
 */
export class UiHub implements BeforeApplicationShutdown {
	private readonly clients = new Map<string, Set<Client>>();
	private readonly lastAnnounce = new Map<string, { event: UiNewSessionEvent; at: number }>();
	private readonly openedAt = new Map<string, number>();

	/** True if a UI of this user is connected, or was just opened and has not yet had time to connect. */
	hasUi(owner: string): boolean {
		return (this.clients.get(owner)?.size ?? 0) > 0 || Date.now() - (this.openedAt.get(owner) ?? 0) < OPEN_GRACE_MS;
	}

	/** To call when the server itself opens a tab for this user. */
	markOpened(owner: string): void {
		this.openedAt.set(owner, Date.now());
	}

	/**
	 * Stream of one of `owner`'s tabs. It closes when the client disconnects, on `closeUser` / `closeSession`, and at
	 * `expiresAt`: it does not outlive the identity that opened it (the UI reconnects and must authenticate again).
	 */
	stream(owner: string, sessionKey: string | null = null, expiresAt?: Date): Observable<MessageEvent> {
		return new Observable<MessageEvent>((subscriber) => {
			const client: Client = { subscriber, sessionKey };
			const set = this.clients.get(owner) ?? new Set<Client>();
			set.add(client);
			this.clients.set(owner, set);
			subscriber.next({ comment: "connecté" });
			const last = this.lastAnnounce.get(owner);
			if (last && Date.now() - last.at < REPLAY_MS) {
				subscriber.next(toMessage(last.event));
			}
			const keepalive = setInterval(() => subscriber.next({ comment: "keepalive" }), KEEPALIVE_MS);
			const expiry = expiresAt
				? setTimeout(
						() => subscriber.complete(),
						Math.min(Math.max(expiresAt.getTime() - Date.now(), 0), MAX_TIMER_MS),
					)
				: undefined;
			return () => {
				clearInterval(keepalive);
				clearTimeout(expiry);
				set.delete(client);
				if (set.size === 0 && this.clients.get(owner) === set) {
					this.clients.delete(owner);
				}
			};
		});
	}

	/** Announces a new question session of `owner` to their open tabs. */
	announce(owner: string, { id, title }: { id: string; title: string }): void {
		const event = { sessionId: id, title };
		const now = Date.now();
		for (const [key, entry] of this.lastAnnounce) {
			if (now - entry.at >= REPLAY_MS) {
				this.lastAnnounce.delete(key);
			}
		}
		this.lastAnnounce.set(owner, { event, at: now });
		for (const { subscriber } of this.clients.get(owner) ?? []) {
			subscriber.next(toMessage(event));
		}
	}

	/** Closes a user's streams (account disabled, password changed), optionally sparing the current session. */
	closeUser(owner: string, exceptSessionKey?: string): void {
		for (const client of [...(this.clients.get(owner) ?? [])]) {
			if (!exceptSessionKey || client.sessionKey !== exceptSessionKey) {
				client.subscriber.complete();
			}
		}
	}

	/** Closes the streams opened with this login session (sign-out). */
	closeSession(sessionKey: string): void {
		for (const set of this.clients.values()) {
			for (const client of [...set]) {
				if (client.sessionKey === sessionKey) {
					client.subscriber.complete();
				}
			}
		}
	}

	/** Before the HTTP server closes, which would otherwise wait for each SSE stream to disconnect. */
	beforeApplicationShutdown(): void {
		for (const set of this.clients.values()) {
			for (const client of [...set]) {
				client.subscriber.complete();
			}
		}
	}
}
