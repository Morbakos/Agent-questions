import { DestroyRef, Injectable, computed, effect, inject, signal } from "@angular/core";
import { Title } from "@angular/platform-browser";
import { Router } from "@angular/router";
import type { UiNewSessionEvent } from "@agent-questions/shared";

/** Reconnection delay after a definitive refusal of the stream: starts at 2 s, doubles up to 60 s (ms). */
const RETRY_MIN_MS = 2_000;
const RETRY_MAX_MS = 60_000;

/**
 * `/api/events` stream: the server announces the agent's new questions. On a page where there is nothing to lose
 * (list, confirmation…) we go there directly; on a displayed form we offer it, without forcing the user's hand.
 */
@Injectable({ providedIn: "root" })
export class LiveService {
	private readonly router = inject(Router);
	private readonly title = inject(Title);
	private readonly destroyRef = inject(DestroyRef);

	/** True while a form to fill in is displayed (set by the session page). */
	readonly editing = signal(false);
	private readonly incoming = signal<UiNewSessionEvent | null>(null);
	/** New questions offered to the user, only while a form is displayed. */
	readonly offer = computed(() => (this.editing() ? this.incoming() : null));

	/** Tab title before the "(1)" marker is added; `null` while there is none. */
	private baseTitle: string | null = null;

	constructor() {
		this.destroyRef.onDestroy(() => this.stop());
		// A proposal makes no sense once the form is left: the list shows the session.
		effect(() => {
			if (!this.editing()) {
				this.incoming.set(null);
			}
		});
	}

	private source: EventSource | null = null;
	private retry: ReturnType<typeof setTimeout> | undefined;
	private retryDelay = RETRY_MIN_MS;
	private readonly onVisibility = () => {
		if (!document.hidden) {
			this.clearUnseen();
		}
	};

	/** Opens the stream. Call it once the user is identified: without a session, the server answers 401 (in server mode). */
	start(): void {
		if (typeof EventSource === "undefined" || this.source) {
			return;
		}
		document.addEventListener("visibilitychange", this.onVisibility);
		this.connect();
	}

	/** Closes the stream (sign-out) and clears what was proposed. */
	stop(): void {
		clearTimeout(this.retry);
		this.source?.close();
		this.source = null;
		this.retryDelay = RETRY_MIN_MS;
		this.incoming.set(null);
		document.removeEventListener("visibilitychange", this.onVisibility);
	}

	private connect(): void {
		const source = new EventSource("/api/events");
		this.source = source;
		source.addEventListener("open", () => (this.retryDelay = RETRY_MIN_MS));
		source.addEventListener("new-session", (event) => {
			try {
				this.onNewSession(JSON.parse((event as MessageEvent<string>).data) as UiNewSessionEvent);
			} catch {
				/* unreadable event: ignored */
			}
		});
		source.addEventListener("error", () => {
			// While the browser is retrying (CONNECTING), we let it. A definitive refusal (401, 403) closes the
			// stream: we reopen it ourselves, with an increasing delay.
			if (source.readyState !== EventSource.CLOSED || this.source !== source) {
				return;
			}
			this.source = null;
			this.retry = setTimeout(() => this.connect(), this.retryDelay);
			this.retryDelay = Math.min(this.retryDelay * 2, RETRY_MAX_MS);
		});
	}

	/** Goes to the proposed questions. */
	open(): void {
		const offer = this.offer();
		if (!offer) {
			return;
		}
		this.incoming.set(null);
		void this.router.navigate(["/s", offer.sessionId]);
	}

	/** Ignores the proposed questions (they stay available in the pending list). */
	dismiss(): void {
		this.incoming.set(null);
	}

	private onNewSession(event: UiNewSessionEvent): void {
		if (this.router.url === `/s/${event.sessionId}`) {
			return; // already there (it is the tab the server has just opened)
		}
		this.markUnseen();
		if (this.editing()) {
			this.incoming.set(event);
			return;
		}
		void this.router.navigate(["/s", event.sessionId]);
	}

	/** A site cannot bring its tab to the foreground: in the background, we flag it in its title. */
	private markUnseen(): void {
		if (!document.hidden || this.baseTitle !== null) {
			return;
		}
		this.baseTitle = this.title.getTitle();
		this.title.setTitle(`(1) ${this.baseTitle}`);
	}

	private clearUnseen(): void {
		if (this.baseTitle === null) {
			return;
		}
		this.title.setTitle(this.baseTitle);
		this.baseTitle = null;
	}
}
