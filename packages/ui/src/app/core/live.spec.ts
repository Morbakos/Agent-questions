import { TestBed } from "@angular/core/testing";
import { Title } from "@angular/platform-browser";
import { Router } from "@angular/router";
import { LiveService } from "./live";

class FakeEventSource {
	static readonly CLOSED = 2;
	static instances: FakeEventSource[] = [];
	closed = false;
	readyState = 1;
	private listeners = new Map<string, (event: MessageEvent<string>) => void>();

	constructor(readonly url: string) {
		FakeEventSource.instances.push(this);
	}

	addEventListener(type: string, listener: (event: MessageEvent<string>) => void) {
		this.listeners.set(type, listener);
	}

	close() {
		this.closed = true;
	}

	/** The browser gives up on the connection (for example after a 401). */
	refuse() {
		this.readyState = FakeEventSource.CLOSED;
		this.emit("error", "");
	}

	emit(type: string, data: string) {
		this.listeners.get(type)?.({ data } as MessageEvent<string>);
	}
}

describe("LiveService", () => {
	const navigate = vi.fn().mockResolvedValue(true);
	const router = { navigate, url: "/" };
	const announce = (sessionId = "abc", title = "Nouvelles questions") =>
		FakeEventSource.instances[0]!.emit("new-session", JSON.stringify({ sessionId, title }));

	let live: LiveService;

	beforeEach(() => {
		FakeEventSource.instances = [];
		navigate.mockClear();
		router.url = "/";
		vi.stubGlobal("EventSource", FakeEventSource);
		TestBed.configureTestingModule({ providers: [{ provide: Router, useValue: router }] });
		live = TestBed.inject(LiveService);
		live.start();
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it("connects to the server's event stream", () => {
		expect(FakeEventSource.instances.map((s) => s.url)).toEqual(["/api/events"]);
	});

	it("goes straight to the new questions when there is no form to fill in", () => {
		announce();
		expect(navigate).toHaveBeenCalledWith(["/s", "abc"]);
		expect(live.offer()).toBeNull();
	});

	it("offers to go there, without navigating, when a form is displayed", () => {
		live.editing.set(true);
		announce("abc", "Mon titre");
		expect(navigate).not.toHaveBeenCalled();
		expect(live.offer()).toEqual({ sessionId: "abc", title: "Mon titre" });
	});

	it("goes to the proposed questions when the user accepts", () => {
		live.editing.set(true);
		announce();
		live.open();
		expect(navigate).toHaveBeenCalledWith(["/s", "abc"]);
		expect(live.offer()).toBeNull();
	});

	it("forgets the proposal when the user ignores it", () => {
		live.editing.set(true);
		announce();
		live.dismiss();
		expect(live.offer()).toBeNull();
		expect(navigate).not.toHaveBeenCalled();
	});

	it("keeps the latest proposal when several sessions arrive", () => {
		live.editing.set(true);
		announce("a", "Première");
		announce("b", "Seconde");
		expect(live.offer()?.sessionId).toBe("b");
	});

	it("drops the proposal when the user leaves the form", () => {
		live.editing.set(true);
		announce();
		live.editing.set(false);
		TestBed.tick();
		live.editing.set(true);
		expect(live.offer()).toBeNull();
	});

	it("does nothing for the session already displayed (the tab the server has just opened)", () => {
		router.url = "/s/abc";
		live.editing.set(true);
		announce();
		expect(navigate).not.toHaveBeenCalled();
		expect(live.offer()).toBeNull();
	});

	describe("background tab", () => {
		const title = () => TestBed.inject(Title);
		const setHidden = (hidden: boolean) => vi.spyOn(document, "hidden", "get").mockReturnValue(hidden);

		beforeEach(() => title().setTitle("Questions de l'agent"));

		it("flags the new questions in the title, then restores it when the tab is back in focus", () => {
			setHidden(true);
			announce();
			announce("def");
			expect(title().getTitle()).toBe("(1) Questions de l'agent");

			setHidden(false);
			document.dispatchEvent(new Event("visibilitychange"));
			expect(title().getTitle()).toBe("Questions de l'agent");
		});

		it("leaves the title alone when the tab is visible", () => {
			setHidden(false);
			announce();
			expect(title().getTitle()).toBe("Questions de l'agent");
		});
	});

	it("does not open a second stream if start is called twice", () => {
		live.start();
		expect(FakeEventSource.instances).toHaveLength(1);
	});

	it("closes the stream on stop (sign-out) and can reopen it afterwards", () => {
		live.stop();
		expect(FakeEventSource.instances[0]!.closed).toBe(true);
		live.start();
		expect(FakeEventSource.instances).toHaveLength(2);
	});

	it("reopens the stream, with an increasing delay, when the server refuses it (session not open yet)", () => {
		vi.useFakeTimers();
		try {
			FakeEventSource.instances[0]!.refuse();
			expect(FakeEventSource.instances).toHaveLength(1);
			vi.advanceTimersByTime(2_000);
			expect(FakeEventSource.instances).toHaveLength(2);
			FakeEventSource.instances[1]!.refuse();
			vi.advanceTimersByTime(2_000);
			expect(FakeEventSource.instances).toHaveLength(2); // doubled delay: 4 s
			vi.advanceTimersByTime(2_000);
			expect(FakeEventSource.instances).toHaveLength(3);
		} finally {
			vi.useRealTimers();
		}
	});

	it("no longer tries to reopen the stream after stop", () => {
		vi.useFakeTimers();
		try {
			FakeEventSource.instances[0]!.refuse();
			live.stop();
			vi.advanceTimersByTime(60_000);
			expect(FakeEventSource.instances).toHaveLength(1);
		} finally {
			vi.useRealTimers();
		}
	});

	it("ignores an unreadable event", () => {
		expect(() => FakeEventSource.instances[0]!.emit("new-session", "pas du json")).not.toThrow();
		expect(navigate).not.toHaveBeenCalled();
	});

	it("closes the stream when the application is destroyed", () => {
		TestBed.resetTestingModule();
		expect(FakeEventSource.instances[0]!.closed).toBe(true);
	});

	it("does nothing when the browser has no EventSource", () => {
		TestBed.resetTestingModule();
		FakeEventSource.instances = [];
		vi.stubGlobal("EventSource", undefined);
		TestBed.configureTestingModule({ providers: [{ provide: Router, useValue: router }] });
		expect(() => TestBed.inject(LiveService).start()).not.toThrow();
		expect(FakeEventSource.instances).toHaveLength(0);
	});
});
