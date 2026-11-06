import { randomUUID } from "node:crypto";
import { MikroORM } from "@mikro-orm/core";
import { Inject, Injectable } from "@nestjs/common";
import type { Answers } from "@agent-questions/shared";
import type { Session } from "@app/sessions/domain/session.js";
import type { SessionCursor } from "@app/sessions/domain/session-cursor.js";
import { SessionEntity } from "./session.entity.js";
import { type NewSession, type Outcome, SessionRepository } from "./session.repository.js";

const toSession = ({
	id,
	ownerId,
	title,
	status,
	revision,
	questions,
	draft,
	answers,
	declineReason,
	createdAt,
	answeredAt,
	deliveredAt,
}: SessionEntity): Session => ({
	id,
	ownerId,
	title,
	status,
	revision,
	questions,
	draft,
	answers,
	declineReason,
	createdAt,
	answeredAt,
	deliveredAt,
});

/**
 * MikroORM implementation. Each operation works in a **forked** `EntityManager` (no global context to share between
 * concurrent requests) and always filters on the owner.
 */
@Injectable()
export class MikroSessionRepository extends SessionRepository {
	constructor(@Inject(MikroORM) private readonly orm: MikroORM) {
		super();
	}

	/** A new fork on every access: each repository operation gets its own `EntityManager`. */
	private get em() {
		return this.orm.em.fork();
	}

	async get(owner: string, id: string): Promise<Session | undefined> {
		const entity = await this.em.findOne(SessionEntity, { id, ownerId: owner });
		return entity ? toSession(entity) : undefined;
	}

	async findReusable(owner: string, hash: string): Promise<Session | undefined> {
		const [entity] = await this.em.find(
			SessionEntity,
			{ hash, ownerId: owner, $or: [{ status: "pending" }, { deliveredAt: null }] },
			{ orderBy: { createdAt: "desc" }, limit: 1 },
		);
		return entity ? toSession(entity) : undefined;
	}

	async create(owner: string, input: NewSession): Promise<Session> {
		const em = this.em;
		const entity = em.create(SessionEntity, {
			id: randomUUID(),
			hash: input.hash,
			title: input.title,
			questions: input.questions,
			draft: {},
			answers: null,
			status: "pending",
			revision: 0,
			createdAt: Date.now(),
			ownerId: owner,
		});
		await em.flush();
		return toSession(entity);
	}

	async findOrCreate(
		owner: string,
		input: NewSession,
		limit: number,
	): Promise<{ session: Session; created: boolean } | undefined> {
		// One transaction: the SQLite dialect has a single connection, concurrent calls run one after another, so the second
		// finds the session created by the first instead of creating another.
		return this.em.transactional(async (em) => {
			const [reusable] = await em.find(
				SessionEntity,
				{
					hash: input.hash,
					ownerId: owner,
					$or: [{ status: "pending" }, { deliveredAt: null }],
				},
				{ orderBy: { createdAt: "desc" }, limit: 1 },
			);
			if (reusable) {
				return { session: toSession(reusable), created: false };
			}
			if ((await em.count(SessionEntity, { ownerId: owner, status: "pending" })) >= limit) {
				return undefined;
			}
			const entity = em.create(SessionEntity, {
				id: randomUUID(),
				hash: input.hash,
				title: input.title,
				questions: input.questions,
				draft: {},
				answers: null,
				status: "pending",
				revision: 0,
				createdAt: Date.now(),
				ownerId: owner,
			});
			return { session: toSession(entity), created: true };
		});
	}

	async replaceQuestions(owner: string, id: string, input: NewSession & { draft: Answers }): Promise<void> {
		await this.em.transactional(async (em) => {
			const entity = await em.findOne(SessionEntity, { id, ownerId: owner });
			if (entity) {
				entity.title = input.title;
				entity.questions = input.questions;
				entity.draft = input.draft;
				entity.hash = input.hash;
				entity.revision += 1;
			}
		});
	}

	async saveDraft(owner: string, id: string, draft: Answers): Promise<void> {
		await this.em.nativeUpdate(SessionEntity, { id, ownerId: owner }, { draft });
	}

	async close(owner: string, id: string, outcome: Outcome, at: number): Promise<void> {
		const data =
			outcome.kind === "answered"
				? { status: "answered" as const, answers: outcome.answers, answeredAt: at }
				: { status: "declined" as const, declineReason: outcome.reason, answeredAt: at };
		await this.em.nativeUpdate(SessionEntity, { id, ownerId: owner }, data);
	}

	async markDelivered(owner: string, id: string, at: number): Promise<void> {
		await this.em.nativeUpdate(SessionEntity, { id, ownerId: owner, deliveredAt: null }, { deliveredAt: at });
	}

	async listOpen(owner: string): Promise<Session[]> {
		const rows = await this.em.find(
			SessionEntity,
			{ ownerId: owner, status: "pending" },
			{ orderBy: { createdAt: "desc" } },
		);
		return rows.map(toSession);
	}

	async listClosed(owner: string, limit: number, before?: SessionCursor): Promise<Session[]> {
		const closed = { ownerId: owner, status: { $ne: "pending" as const } };
		const rows = await this.em.find(
			SessionEntity,
			before
				? {
						...closed,
						$or: [{ answeredAt: { $lt: before.at } }, { answeredAt: before.at, id: { $lt: before.id } }],
					}
				: { ...closed, answeredAt: { $ne: null } },
			{ orderBy: { answeredAt: "desc", id: "desc" }, limit },
		);
		return rows.map(toSession);
	}

	async findAnyById(id: string): Promise<Session | undefined> {
		const entity = await this.em.findOne(SessionEntity, { id });
		return entity ? toSession(entity) : undefined;
	}

	async listAll(limit: number, before?: SessionCursor): Promise<Session[]> {
		const rows = await this.em.find(
			SessionEntity,
			before
				? { $or: [{ createdAt: { $lt: before.at } }, { createdAt: before.at, id: { $lt: before.id } }] }
				: {},
			{ orderBy: { createdAt: "desc", id: "desc" }, limit },
		);
		return rows.map(toSession);
	}

	async reassignOwner(from: string, to: string): Promise<number> {
		return this.em.nativeUpdate(SessionEntity, { ownerId: from }, { ownerId: to });
	}
}
