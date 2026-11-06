import { Entity, PrimaryKey, Property } from "@mikro-orm/decorators/legacy";
import type { Answers, Question, Status } from "@agent-questions/shared";

/**
 * Row of the `sessions` table. Types are declared explicitly: Bun and esbuild do not emit
 * `emitDecoratorMetadata`, so MikroORM cannot infer them. The schema lives in `storage/migrations/`.
 */
@Entity({ tableName: "sessions" })
export class SessionEntity {
	@PrimaryKey({ type: "string" })
	id!: string;

	@Property({ type: "string" })
	hash!: string;

	@Property({ type: "string" })
	title!: string;

	@Property({ type: "json" })
	questions!: Question[];

	@Property({ type: "json" })
	draft: Answers = {};

	@Property({ type: "json", nullable: true })
	answers: Answers | null = null;

	@Property({ type: "string" })
	status: Status = "pending";

	@Property({ type: "number" })
	revision = 0;

	@Property({ type: "string", fieldName: "decline_reason", nullable: true })
	declineReason: string | null = null;

	@Property({ type: "number", fieldName: "created_at" })
	createdAt!: number;

	@Property({ type: "number", fieldName: "answered_at", nullable: true })
	answeredAt: number | null = null;

	@Property({ type: "number", fieldName: "delivered_at", nullable: true })
	deliveredAt: number | null = null;

	@Property({ type: "string", fieldName: "owner_user_id" })
	ownerId!: string;
}
