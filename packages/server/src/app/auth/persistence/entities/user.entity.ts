import { Entity, PrimaryKey, Property } from "@mikro-orm/decorators/legacy";
import type { Role } from "@agent-questions/shared";

/** Table `users`. Case-insensitive uniqueness of `username` is carried by the schema (`COLLATE NOCASE`). */
@Entity({ tableName: "users" })
export class UserEntity {
	@PrimaryKey({ type: "string" })
	id!: string;

	@Property({ type: "string" })
	username!: string;

	@Property({ type: "string", fieldName: "password_hash", nullable: true })
	passwordHash: string | null = null;

	@Property({ type: "string" })
	role: Role = "member";

	@Property({ type: "boolean" })
	disabled = false;

	@Property({ type: "number", fieldName: "created_at" })
	createdAt!: number;
}
