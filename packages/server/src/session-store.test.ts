import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError, SessionStore } from "./session-store.js";
import { singleQuestion, textQuestion } from "./test-helpers.js";

let store: SessionStore;

beforeEach(() => {
	store = new SessionStore(":memory:");
});

const create = (title = "Titre") =>
	store.findOrCreate({ title, questions: [singleQuestion(), textQuestion()] }).session;

describe("findOrCreate", () => {
	it("retrouve la session en attente pour les mêmes titre et questions", () => {
		const first = create();
		const again = store.findOrCreate({ title: "Titre", questions: [singleQuestion(), textQuestion()] });
		expect(again.created).toBe(false);
		expect(again.session.id).toBe(first.id);
	});

	it("crée une nouvelle session quand le titre change", () => {
		expect(create("A").id).not.toBe(create("B").id);
	});

	it("crée une nouvelle session quand une question est reformulée", () => {
		const first = create();
		const other = store.findOrCreate({
			title: "Titre",
			questions: [singleQuestion({ prompt: "Autre formulation" }), textQuestion()],
		});
		expect(other.session.id).not.toBe(first.id);
	});

	it("reprend une session par son identifiant et refuse un identifiant inconnu", () => {
		const first = create();
		expect(store.findOrCreate({ sessionId: first.id, title: "x", questions: [] }).session.id).toBe(first.id);
		expect(() => store.findOrCreate({ sessionId: "inconnu", title: "x", questions: [] })).toThrow();
	});

	it("ne réutilise plus une session répondue dont les réponses ont été livrées", () => {
		const first = create();
		store.submit(first.id, { choix: { selected: ["a"], text: "" }, libre: { selected: [], text: "ok" } });
		expect(create().id).toBe(first.id);
		store.markDelivered(first.id);
		expect(create().id).not.toBe(first.id);
	});
});

describe("submit et decline", () => {
	it("enregistre des réponses valides", () => {
		const s = create();
		const done = store.submit(s.id, { choix: { selected: ["b"], text: "" }, libre: { selected: [], text: "ok" } });
		expect(done.status).toBe("answered");
		expect(done.answers?.choix?.selected).toEqual(["b"]);
	});

	it("refuse des réponses invalides avec le détail des erreurs", () => {
		const s = create();
		try {
			store.submit(s.id, {});
			expect.unreachable();
		} catch (err) {
			expect(err).toBeInstanceOf(HttpError);
			expect((err as HttpError).status).toBe(422);
			expect((err as HttpError).details?.length).toBeGreaterThan(0);
		}
	});

	it("enregistre un refus avec sa raison", () => {
		const s = create();
		const done = store.decline(s.id, "pas le temps");
		expect(done.status).toBe("declined");
		expect(done.declineReason).toBe("pas le temps");
	});

	it("refuse toute modification d'une session déjà clôturée (409)", () => {
		const s = create();
		store.decline(s.id, "");
		for (const act of [
			() => store.submit(s.id, {}),
			() => store.decline(s.id, ""),
			() => store.saveDraft(s.id, {}),
			() => store.updateQuestions(s.id, undefined, [textQuestion()]),
		]) {
			expect(act).toThrowError(expect.objectContaining({ status: 409 }));
		}
	});

	it("répond 404 pour une session inconnue", () => {
		expect(() => store.decline("inconnu", "")).toThrowError(expect.objectContaining({ status: 404 }));
	});
});

describe("updateQuestions", () => {
	it("remplace les questions, incrémente la révision et change le hash", () => {
		const s = create();
		const updated = store.updateQuestions(s.id, "Nouveau titre", [textQuestion({ prompt: "Nouvelle" })]);
		expect(updated.revision).toBe(s.revision + 1);
		expect(updated.title).toBe("Nouveau titre");
		expect(updated.questions).toHaveLength(1);
		// Le nouveau contenu est retrouvé par findOrCreate (hash recalculé).
		const found = store.findOrCreate({ title: "Nouveau titre", questions: [textQuestion({ prompt: "Nouvelle" })] });
		expect(found.session.id).toBe(s.id);
	});

	it("garde le titre si aucun n'est fourni", () => {
		const s = create("Garde-moi");
		expect(store.updateQuestions(s.id, undefined, [textQuestion()]).title).toBe("Garde-moi");
	});

	it("conserve le brouillon des questions qui subsistent, sans les options disparues", () => {
		const s = create();
		store.saveDraft(s.id, {
			choix: { selected: ["a", "b"], text: "" },
			libre: { selected: [], text: "brouillon" },
		});
		const updated = store.updateQuestions(s.id, undefined, [
			singleQuestion({
				options: [
					{ id: "b", label: "B" },
					{ id: "c", label: "C" },
				],
			}),
		]);
		expect(updated.draft).toEqual({ choix: { selected: ["b"], text: "" } });
	});
});

describe("wait", () => {
	it("se réveille dès que l'utilisateur répond", async () => {
		const s = create();
		const waiting = store.wait(s.id, 5_000);
		store.submit(s.id, { choix: { selected: ["a"], text: "" }, libre: { selected: [], text: "ok" } });
		expect((await waiting).status).toBe("answered");
	});

	it("se réveille dès que l'utilisateur refuse", async () => {
		const s = create();
		const waiting = store.wait(s.id, 5_000);
		store.decline(s.id, "non");
		expect((await waiting).status).toBe("declined");
	});

	it("rend la main au bout du délai, toujours en attente", async () => {
		const s = create();
		expect((await store.wait(s.id, 20)).status).toBe("pending");
	});

	it("rend la main aussitôt si le délai est nul", async () => {
		expect((await store.wait(create().id, 0)).status).toBe("pending");
	});

	it("rend la main quand l'appelant abandonne", async () => {
		const s = create();
		const controller = new AbortController();
		const waiting = store.wait(s.id, 5_000, controller.signal);
		controller.abort();
		expect((await waiting).status).toBe("pending");
	});
});

describe("listOpen et touch", () => {
	it("ne liste que les sessions en attente", () => {
		const a = create("A");
		const b = create("B");
		store.decline(a.id, "");
		expect(store.listOpen().map((s) => s.id)).toEqual([b.id]);
	});

	it("renseigne lastSeenAt", () => {
		const s = create();
		expect(s.lastSeenAt).toBeNull();
		store.touch(s.id);
		expect(store.get(s.id)?.lastSeenAt).not.toBeNull();
	});
});

describe("listClosed", () => {
	afterEach(() => vi.restoreAllMocks());

	/** Clôture une session à une date donnée (les dates sont à la milliseconde : on les fixe pour l'ordre). */
	const closeAt = (title: string, at: number) => {
		const s = create(title);
		vi.spyOn(Date, "now").mockReturnValue(at);
		store.decline(s.id, "");
		return s;
	};

	it("ne renvoie que les sessions clôturées, plus récentes d'abord", () => {
		const old = closeAt("ancienne", 1000);
		const recent = closeAt("récente", 2000);
		create("en attente");
		const page = store.listClosed(10);
		expect(page.items.map((s) => s.id)).toEqual([recent.id, old.id]);
		expect(page.nextBefore).toBeNull();
	});

	it("pagine avec un curseur", () => {
		const ids = [1, 2, 3, 4, 5].map((at) => closeAt(`S${at}`, at * 1000).id);
		const first = store.listClosed(2);
		expect(first.items.map((s) => s.id)).toEqual([ids[4], ids[3]]);
		expect(first.nextBefore).toBe(4000);
		const second = store.listClosed(2, first.nextBefore!);
		expect(second.items.map((s) => s.id)).toEqual([ids[2], ids[1]]);
		const last = store.listClosed(2, second.nextBefore!);
		expect(last.items.map((s) => s.id)).toEqual([ids[0]]);
		expect(last.nextBefore).toBeNull();
	});

	it("n'a pas de page suivante quand la dernière page est pleine", () => {
		closeAt("A", 1000);
		closeAt("B", 2000);
		expect(store.listClosed(2).nextBefore).toBeNull();
	});
});

describe("migration d'une base ancienne", () => {
	let dir: string;
	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "aq-"));
	});
	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it("ajoute la colonne revision sans perdre les sessions", () => {
		const file = join(dir, "old.sqlite");
		const old = new DatabaseSync(file);
		old.exec(`
			CREATE TABLE sessions (
				id TEXT PRIMARY KEY, hash TEXT NOT NULL, title TEXT NOT NULL, questions TEXT NOT NULL,
				draft TEXT NOT NULL DEFAULT '{}', answers TEXT, status TEXT NOT NULL DEFAULT 'pending',
				decline_reason TEXT, created_at INTEGER NOT NULL, answered_at INTEGER, delivered_at INTEGER,
				last_seen_at INTEGER
			);
			INSERT INTO sessions (id, hash, title, questions, created_at) VALUES ('s1', 'h', 'Ancienne', '[]', 1);
		`);
		old.close();

		const migrated = new SessionStore(file);
		expect(migrated.get("s1")?.title).toBe("Ancienne");
		expect(migrated.get("s1")?.revision).toBe(0);
		migrated.close();
		// Rouvrir la base déjà migrée ne doit pas échouer.
		const reopened = new SessionStore(file);
		expect(reopened.get("s1")?.title).toBe("Ancienne");
		reopened.close();
	});
});
