import { Entity, PrimaryKey, Property } from "@mikro-orm/decorators/legacy";

/**
 * Login session (cookie), in the format of `@nestjs/authentication`'s `SessionStore`: `id` is the SHA-256 hash of the
 * cookie token (the token itself is never stored). Dates are milliseconds since the epoch.
 */
@Entity({ tableName: "auth_sessions" })
export class AuthSessionEntity {
	@PrimaryKey({ type: "string" })
	id!: string;

	@Property({ type: "string", fieldName: "user_id" })
	userId!: string;

	@Property({ type: "number", fieldName: "created_at" })
	createdAt!: number;

	@Property({ type: "number", fieldName: "expires_at" })
	expiresAt!: number;

	@Property({ type: "number", fieldName: "last_active_at" })
	lastActiveAt!: number;

	@Property({ type: "string", nullable: true })
	mfa: string | null = null;

	@Property({ type: "json", nullable: true })
	metadata: Record<string, unknown> | null = null;
}
