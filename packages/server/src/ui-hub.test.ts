import type { ServerResponse } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UiHub } from "./ui-hub.js";

/** Réponse HTTP minimale : on ne regarde que ce qui est écrit et la fermeture. */
function fakeResponse() {
	const closeHandlers: (() => void)[] = [];
	const res = {
		written: [] as string[],
		write(chunk: string) {
			this.written.push(chunk);
			return true;
		},
		on(event: string, handler: () => void) {
			if (event === "close") {
				closeHandlers.push(handler);
			}
		},
		close: () => closeHandlers.forEach((h) => h()),
	};
	return res as typeof res & ServerResponse;
}

const session = { id: "s1", title: "Mon titre" };
const expected = 'event: new-session\ndata: {"sessionId":"s1","title":"Mon titre"}\n\n';

let hub: UiHub;

beforeEach(() => {
	vi.useFakeTimers();
	hub = new UiHub();
});

afterEach(() => vi.useRealTimers());

describe("hasUi", () => {
	it("est faux sans onglet connecté ni ouverture récente", () => {
		expect(hub.hasUi).toBe(false);
	});

	it("est vrai tant qu'un onglet est connecté, et faux après sa fermeture", () => {
		const res = fakeResponse();
		hub.add(res);
		vi.advanceTimersByTime(10 * 60_000);
		expect(hub.hasUi).toBe(true);
		res.close();
		expect(hub.hasUi).toBe(false);
	});

	it("compte un onglet qu'on vient d'ouvrir, le temps qu'il se connecte", () => {
		hub.markOpened();
		expect(hub.hasUi).toBe(true);
		vi.advanceTimersByTime(16_000);
		expect(hub.hasUi).toBe(false);
	});
});

describe("announce", () => {
	it("annonce la session (identifiant et titre) à tous les onglets connectés", () => {
		const a = fakeResponse();
		const b = fakeResponse();
		hub.add(a);
		hub.add(b);
		hub.announce(session);
		expect(a.written).toEqual([expected]);
		expect(b.written).toEqual([expected]);
	});

	it("n'écrit plus dans un onglet fermé", () => {
		const res = fakeResponse();
		hub.add(res);
		res.close();
		hub.announce(session);
		expect(res.written).toEqual([]);
	});

	it("rejoue une annonce récente à l'onglet qui se connecte juste après", () => {
		hub.announce(session);
		const res = fakeResponse();
		hub.add(res);
		expect(res.written).toEqual([expected]);
	});

	it("ne rejoue pas une annonce ancienne", () => {
		hub.announce(session);
		vi.advanceTimersByTime(11_000);
		const res = fakeResponse();
		hub.add(res);
		expect(res.written).toEqual([]);
	});
});
