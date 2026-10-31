import { TestBed } from "@angular/core/testing";
import { Title } from "@angular/platform-browser";
import { Router } from "@angular/router";
import { LiveService } from "./live";

class FakeEventSource {
	static instances: FakeEventSource[] = [];
	closed = false;
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

	it("se connecte au flux d'événements du serveur", () => {
		expect(FakeEventSource.instances.map((s) => s.url)).toEqual(["/api/events"]);
	});

	it("va directement sur les nouvelles questions quand il n'y a pas de formulaire à remplir", () => {
		announce();
		expect(navigate).toHaveBeenCalledWith(["/s", "abc"]);
		expect(live.offer()).toBeNull();
	});

	it("propose d'y aller, sans naviguer, quand un formulaire est affiché", () => {
		live.editing.set(true);
		announce("abc", "Mon titre");
		expect(navigate).not.toHaveBeenCalled();
		expect(live.offer()).toEqual({ sessionId: "abc", title: "Mon titre" });
	});

	it("va sur les questions proposées quand l'utilisateur accepte", () => {
		live.editing.set(true);
		announce();
		live.open();
		expect(navigate).toHaveBeenCalledWith(["/s", "abc"]);
		expect(live.offer()).toBeNull();
	});

	it("oublie la proposition quand l'utilisateur l'ignore", () => {
		live.editing.set(true);
		announce();
		live.dismiss();
		expect(live.offer()).toBeNull();
		expect(navigate).not.toHaveBeenCalled();
	});

	it("garde la dernière proposition quand plusieurs sessions arrivent", () => {
		live.editing.set(true);
		announce("a", "Première");
		announce("b", "Seconde");
		expect(live.offer()?.sessionId).toBe("b");
	});

	it("retire la proposition quand l'utilisateur quitte le formulaire", () => {
		live.editing.set(true);
		announce();
		live.editing.set(false);
		TestBed.tick();
		live.editing.set(true);
		expect(live.offer()).toBeNull();
	});

	it("ne fait rien pour la session déjà affichée (l'onglet que le serveur vient d'ouvrir)", () => {
		router.url = "/s/abc";
		live.editing.set(true);
		announce();
		expect(navigate).not.toHaveBeenCalled();
		expect(live.offer()).toBeNull();
	});

	describe("onglet en arrière-plan", () => {
		const title = () => TestBed.inject(Title);
		const setHidden = (hidden: boolean) => vi.spyOn(document, "hidden", "get").mockReturnValue(hidden);

		beforeEach(() => title().setTitle("Questions de l'agent"));

		it("signale les nouvelles questions dans le titre, puis le restaure au retour sur l'onglet", () => {
			setHidden(true);
			announce();
			announce("def");
			expect(title().getTitle()).toBe("(1) Questions de l'agent");

			setHidden(false);
			document.dispatchEvent(new Event("visibilitychange"));
			expect(title().getTitle()).toBe("Questions de l'agent");
		});

		it("ne touche pas au titre quand l'onglet est visible", () => {
			setHidden(false);
			announce();
			expect(title().getTitle()).toBe("Questions de l'agent");
		});
	});

	it("ferme le flux quand l'application est détruite", () => {
		TestBed.resetTestingModule();
		expect(FakeEventSource.instances[0]!.closed).toBe(true);
	});

	it("ne fait rien quand le navigateur n'a pas EventSource", () => {
		TestBed.resetTestingModule();
		FakeEventSource.instances = [];
		vi.stubGlobal("EventSource", undefined);
		TestBed.configureTestingModule({ providers: [{ provide: Router, useValue: router }] });
		expect(() => TestBed.inject(LiveService).start()).not.toThrow();
		expect(FakeEventSource.instances).toHaveLength(0);
	});
});
