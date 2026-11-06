import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { MikroORM } from "@mikro-orm/core";
import { Test, type TestingModule } from "@nestjs/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseCursor } from "@app/http/cursor.js";
import { HttpError } from "@app/http/http-error.js";
import { createOrm } from "@app/storage/orm.js";
import { MikroSessionRepository } from "@app/sessions/persistence/mikro-session.repository.js";
import { SessionRepository } from "@app/sessions/persistence/session.repository.js";
import { MAX_PENDING_PER_OWNER, SessionsService } from "./sessions.service.js";
import { memoryOrm, singleQuestion, textQuestion } from "@server/test-helpers.js";

const OWNER = "u1";
const OTHER = "u2";

let orm: MikroORM;
let moduleRef: TestingModule;
let store: SessionsService;

/** Nest module on a given database, wired like `CoreModule` (real MikroORM repository injected). */
const moduleOn = (o: MikroORM) =>
	Test.createTestingModule({
		providers: [
			SessionsService,
			{ provide: SessionRepository, useClass: MikroSessionRepository },
			{ provide: MikroORM, useValue: o },
		],
	}).compile();

beforeEach(async () => {
	orm = await memoryOrm();
	moduleRef = await moduleOn(orm);
	store = moduleRef.get(SessionsService);
});

afterEach(async () => {
	await moduleRef.close();
	await orm.close();
});

const create = async (title = "Titre") =>
	(await store.findOrCreate(OWNER, { title, questions: [singleQuestion(), textQuestion()] })).session;

describe("findOrCreate", () => {
	it("finds the pending session for the same title and questions", async () => {
		const first = await create();
		const again = await store.findOrCreate(OWNER, {
			title: "Titre",
			questions: [singleQuestion(), textQuestion()],
		});
		expect(again.created).toBe(false);
		expect(again.session.id).toBe(first.id);
	});

	it("creates only one session for two identical, simultaneous calls", async () => {
		const input = { title: "Titre", questions: [singleQuestion(), textQuestion()] };
		const [a, b] = await Promise.all([store.findOrCreate(OWNER, input), store.findOrCreate(OWNER, input)]);
		expect(a.session.id).toBe(b.session.id);
		expect([a.created, b.created].sort()).toEqual([false, true]);
		expect(await store.listOpen(OWNER)).toHaveLength(1);
	});

	it("creates a new session when the title changes", async () => {
		expect((await create("A")).id).not.toBe((await create("B")).id);
	});

	it("creates a new session when a question is reworded", async () => {
		const first = await create();
		const other = await store.findOrCreate(OWNER, {
			title: "Titre",
			questions: [singleQuestion({ prompt: "Autre formulation" }), textQuestion()],
		});
		expect(other.session.id).not.toBe(first.id);
	});

	it("resumes a session by its id and rejects an unknown id", async () => {
		const first = await create();
		expect((await store.findOrCreate(OWNER, { sessionId: first.id, title: "x", questions: [] })).session.id).toBe(
			first.id,
		);
		await expect(store.findOrCreate(OWNER, { sessionId: "inconnu", title: "x", questions: [] })).rejects.toThrow();
	});

	it("no longer reuses an answered session whose answers were delivered", async () => {
		const first = await create();
		await store.submit(OWNER, first.id, {
			choix: { selected: ["a"], text: "" },
			libre: { selected: [], text: "ok" },
		});
		expect((await create()).id).toBe(first.id);
		await store.markDelivered(OWNER, first.id);
		expect((await create()).id).not.toBe(first.id);
	});
});

describe("submit and decline", () => {
	it("stores valid answers", async () => {
		const s = await create();
		const done = await store.submit(OWNER, s.id, {
			choix: { selected: ["b"], text: "" },
			libre: { selected: [], text: "ok" },
		});
		expect(done.status).toBe("answered");
		expect(done.answers?.choix?.selected).toEqual(["b"]);
	});

	it("rejects invalid answers with the error details", async () => {
		const s = await create();
		try {
			await store.submit(OWNER, s.id, {});
			expect.unreachable();
		} catch (err) {
			expect(err).toBeInstanceOf(HttpError);
			expect((err as HttpError).status).toBe(422);
			expect((err as HttpError).details?.length).toBeGreaterThan(0);
		}
	});

	it("stores a decline with its reason", async () => {
		const s = await create();
		const done = await store.decline(OWNER, s.id, "pas le temps");
		expect(done.status).toBe("declined");
		expect(done.declineReason).toBe("pas le temps");
	});

	it("rejects any change to an already closed session (409)", async () => {
		const s = await create();
		await store.decline(OWNER, s.id, "");
		for (const act of [
			() => store.submit(OWNER, s.id, {}),
			() => store.decline(OWNER, s.id, ""),
			() => store.saveDraft(OWNER, s.id, {}),
			() => store.updateQuestions(OWNER, s.id, undefined, [textQuestion()]),
		]) {
			await expect(act()).rejects.toThrowError(expect.objectContaining({ status: 409 }));
		}
	});

	it("answers 404 for an unknown session", async () => {
		await expect(store.decline(OWNER, "inconnu", "")).rejects.toThrowError(
			expect.objectContaining({ status: 404 }),
		);
	});
});

describe("updateQuestions", () => {
	it("replaces the questions, increments the revision and changes the hash", async () => {
		const s = await create();
		const updated = await store.updateQuestions(OWNER, s.id, "Nouveau titre", [
			textQuestion({ prompt: "Nouvelle" }),
		]);
		expect(updated.revision).toBe(s.revision + 1);
		expect(updated.title).toBe("Nouveau titre");
		expect(updated.questions).toHaveLength(1);
		// The new content is found by findOrCreate (hash recomputed).
		const found = await store.findOrCreate(OWNER, {
			title: "Nouveau titre",
			questions: [textQuestion({ prompt: "Nouvelle" })],
		});
		expect(found.session.id).toBe(s.id);
	});

	it("keeps the title when none is provided", async () => {
		const s = await create("Garde-moi");
		expect((await store.updateQuestions(OWNER, s.id, undefined, [textQuestion()])).title).toBe("Garde-moi");
	});

	it("keeps the draft of surviving questions, without the removed options", async () => {
		const s = await create();
		await store.saveDraft(OWNER, s.id, {
			choix: { selected: ["a", "b"], text: "" },
			libre: { selected: [], text: "brouillon" },
		});
		const updated = await store.updateQuestions(OWNER, s.id, undefined, [
			singleQuestion({
				options: [
					{ id: "b", label: "B" },
					{ id: "c", label: "C" },
				],
			}),
		]);
		expect(updated.draft).toEqual({ choix: { selected: ["b"], text: "" } });
	});

	it("drops draft notes of removed options and keeps those of kept options", async () => {
		const s = await create();
		await store.saveDraft(OWNER, s.id, {
			choix: { selected: ["a", "b"], text: "", notes: { a: "note A", b: "note B" } },
		});
		const options = [
			{ id: "b", label: "B" },
			{ id: "c", label: "C" },
		];
		const updated = await store.updateQuestions(OWNER, s.id, undefined, [singleQuestion({ options })]);
		expect(updated.draft).toEqual({ choix: { selected: ["b"], text: "", notes: { b: "note B" } } });
		// The kept draft must pass the submit validation (no "Note sans option choisie").
		const submitted = await store.submit(OWNER, s.id, { choix: updated.draft.choix ?? { selected: [], text: "" } });
		expect(submitted.status).toBe("answered");
	});

	it("drops all draft notes when the question no longer accepts notes", async () => {
		const s = await create();
		await store.saveDraft(OWNER, s.id, { choix: { selected: ["a"], text: "", notes: { a: "note A" } } });
		const updated = await store.updateQuestions(OWNER, s.id, undefined, [singleQuestion({ allow_notes: false })]);
		expect(updated.draft).toEqual({ choix: { selected: ["a"], text: "" } });
	});
});

describe("wait", () => {
	it("wakes up as soon as the user answers", async () => {
		const s = await create();
		const waiting = store.wait(OWNER, s.id, 5_000);
		await store.submit(OWNER, s.id, { choix: { selected: ["a"], text: "" }, libre: { selected: [], text: "ok" } });
		expect((await waiting).status).toBe("answered");
	});

	it("wakes up as soon as the user declines", async () => {
		const s = await create();
		const waiting = store.wait(OWNER, s.id, 5_000);
		await store.decline(OWNER, s.id, "non");
		expect((await waiting).status).toBe("declined");
	});

	it("returns after the timeout, still pending", async () => {
		const s = await create();
		expect((await store.wait(OWNER, s.id, 20)).status).toBe("pending");
	});

	it("returns immediately when the timeout is zero", async () => {
		expect((await store.wait(OWNER, (await create()).id, 0)).status).toBe("pending");
	});

	it("does not make a caller wait whose signal is already aborted", async () => {
		const s = await create();
		const controller = new AbortController();
		controller.abort();
		const started = Date.now();
		expect((await store.wait(OWNER, s.id, 5_000, controller.signal)).status).toBe("pending");
		expect(Date.now() - started).toBeLessThan(1_000);
	});

	it("wakes several waits on the same session", async () => {
		const s = await create();
		const waiters = [store.wait(OWNER, s.id, 5_000), store.wait(OWNER, s.id, 5_000)];
		await store.decline(OWNER, s.id, "non");
		expect((await Promise.all(waiters)).map((w) => w.status)).toEqual(["declined", "declined"]);
	});

	it("returns when the caller aborts", async () => {
		const s = await create();
		const controller = new AbortController();
		const waiting = store.wait(OWNER, s.id, 5_000, controller.signal);
		controller.abort();
		expect((await waiting).status).toBe("pending");
	});
});

describe("isolation between users", () => {
	it("never shows another user's session, even with its id", async () => {
		const mine = await create();
		expect(await store.get(OTHER, mine.id)).toBeUndefined();
		expect(await store.listOpen(OTHER)).toEqual([]);
		await expect(store.submit(OTHER, mine.id, {})).rejects.toThrowError(expect.objectContaining({ status: 404 }));
		await expect(store.decline(OTHER, mine.id, "")).rejects.toThrowError(expect.objectContaining({ status: 404 }));
		await expect(store.findOrCreate(OTHER, { sessionId: mine.id, title: "x", questions: [] })).rejects.toThrow();
	});

	it("does not resume the same questions asked by another user", async () => {
		const mine = await create();
		const theirs = await store.findOrCreate(OTHER, {
			title: "Titre",
			questions: [singleQuestion(), textQuestion()],
		});
		expect(theirs.created).toBe(true);
		expect(theirs.session.id).not.toBe(mine.id);
	});
});

describe("pending sessions quota", () => {
	it("rejects (409) a new session beyond the limit, without affecting another user or a resume", async () => {
		for (let i = 0; i < MAX_PENDING_PER_OWNER; i++) {
			await store.findOrCreate(OWNER, { title: `S${i}`, questions: [textQuestion()] });
		}
		await expect(store.findOrCreate(OWNER, { title: "de trop", questions: [textQuestion()] })).rejects.toThrowError(
			expect.objectContaining({ status: 409 }),
		);
		// The same questions find the existing session: no new session, hence no rejection.
		expect((await store.findOrCreate(OWNER, { title: "S0", questions: [textQuestion()] })).created).toBe(false);
		expect((await store.findOrCreate(OTHER, { title: "de trop", questions: [textQuestion()] })).created).toBe(true);
	});
});

describe("shutdown", () => {
	it("wakes ongoing waits (pending) before closing", async () => {
		const s = await create();
		const waiting = store.wait(OWNER, s.id, 60_000);
		// With no delay: shutdown may occur during the asynchronous re-read of the session, before registration.
		store.beforeApplicationShutdown();
		expect((await waiting).status).toBe("pending");
		// A call arriving after shutdown does not go to sleep either.
		expect((await store.wait(OWNER, s.id, 60_000)).status).toBe("pending");
	});
});

describe("listOpen", () => {
	it("lists only pending sessions", async () => {
		const a = await create("A");
		const b = await create("B");
		await store.decline(OWNER, a.id, "");
		expect((await store.listOpen(OWNER)).map((s) => s.id)).toEqual([b.id]);
	});
});

describe("WAL journal size", () => {
	let dir: string;
	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "aq-"));
	});
	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	const walSize = (file: string) => (existsSync(`${file}-wal`) ? statSync(`${file}-wal`).size : 0);

	it("stays bounded despite many writes on different pages", async () => {
		const file = join(dir, "db.sqlite");
		const fileOrm = await createOrm(file);
		const fileModule = await moduleOn(fileOrm);
		const s = fileModule.get(SessionsService);
		const prompt = "x".repeat(3000);
		let max = 0;
		for (let i = 0; i < 600; i++) {
			const { session } = await s.findOrCreate(OWNER, {
				title: `Session ${i}`,
				questions: [textQuestion({ prompt })],
			});
			await s.decline(OWNER, session.id, ""); // closed: the pending sessions quota does not apply to this test
			max = Math.max(max, walSize(file));
		}
		// By default SQLite lets the WAL grow to ~4 MB (1000 pages) before folding it back: this scenario reaches that.
		expect(max).toBeLessThan(600_000);
		await fileModule.close();
		await fileOrm.close();
	}, 60_000);

	it("flushes at startup the WAL left behind by a hard stop", async () => {
		const file = join(dir, "db.sqlite");
		const crashed = new DatabaseSync(file);
		crashed.exec("PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0; CREATE TABLE t (x TEXT)");
		for (let i = 0; i < 400; i++) {
			crashed.prepare("INSERT INTO t VALUES (?)").run("x".repeat(3000));
		}
		expect(walSize(file)).toBeGreaterThan(1_000_000);

		const fileOrm = await createOrm(file);
		// Only the few pages written by schema creation remain, not the MB left by the hard stop.
		expect(walSize(file)).toBeLessThan(200_000);
		await fileOrm.close();
		crashed.close();
	});
});

describe("listClosed", () => {
	afterEach(() => vi.restoreAllMocks());

	/** Closes a session at a given date (dates have millisecond precision: they are pinned for ordering). */
	const closeAt = async (title: string, at: number) => {
		const s = await create(title);
		vi.spyOn(Date, "now").mockReturnValue(at);
		await store.decline(OWNER, s.id, "");
		return s;
	};

	it("returns only closed sessions, most recent first", async () => {
		const old = await closeAt("ancienne", 1000);
		const recent = await closeAt("récente", 2000);
		await create("en attente");
		const page = await store.listClosed(OWNER, 10);
		expect(page.items.map((s) => s.id)).toEqual([recent.id, old.id]);
		expect(page.nextBefore).toBeNull();
	});

	it("paginates with a cursor", async () => {
		const ids: string[] = [];
		for (const at of [1, 2, 3, 4, 5]) {
			ids.push((await closeAt(`S${at}`, at * 1000)).id);
		}
		const first = await store.listClosed(OWNER, 2);
		expect(first.items.map((s) => s.id)).toEqual([ids[4], ids[3]]);
		expect(first.nextBefore).toBe(`4000:${ids[3]}`);
		const second = await store.listClosed(OWNER, 2, parseCursor(first.nextBefore!));
		expect(second.items.map((s) => s.id)).toEqual([ids[2], ids[1]]);
		const last = await store.listClosed(OWNER, 2, parseCursor(second.nextBefore!));
		expect(last.items.map((s) => s.id)).toEqual([ids[0]]);
		expect(last.nextBefore).toBeNull();
	});

	it("has no next page when the last page is full", async () => {
		await closeAt("A", 1000);
		await closeAt("B", 2000);
		expect((await store.listClosed(OWNER, 2)).nextBefore).toBeNull();
	});

	it("neither skips nor repeats closed sessions sharing the same millisecond", async () => {
		const ids: string[] = [];
		for (const title of ["A", "B", "C", "D", "E"]) {
			ids.push((await closeAt(title, 5000)).id);
		}
		ids.push((await closeAt("avant", 1000)).id);
		const seen: string[] = [];
		let before: string | null | undefined;
		let pages = 0;
		do {
			const page = await store.listClosed(OWNER, 2, parseCursor(before ?? undefined));
			seen.push(...page.items.map((s) => s.id));
			before = page.nextBefore;
			pages++;
		} while (before && pages < 10);
		expect(pages).toBe(3);
		expect([...seen].sort()).toEqual([...ids].sort());
		expect(new Set(seen).size).toBe(ids.length);
	});
});

describe("listAll", () => {
	afterEach(() => vi.restoreAllMocks());

	it("neither skips nor repeats sessions created in the same millisecond", async () => {
		vi.spyOn(Date, "now").mockReturnValue(7000);
		const ids: string[] = [];
		for (const title of ["A", "B", "C", "D", "E"]) {
			ids.push((await create(title)).id);
		}
		const seen: string[] = [];
		let before: string | null | undefined;
		let pages = 0;
		do {
			const page = await store.listAll(2, parseCursor(before ?? undefined));
			seen.push(...page.items.map((s) => s.id));
			before = page.nextBefore;
			pages++;
		} while (before && pages < 10);
		expect(pages).toBe(3);
		expect([...seen].sort()).toEqual([...ids].sort());
		expect(new Set(seen).size).toBe(ids.length);
	});
});
