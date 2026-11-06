import { Entity, PrimaryKey, Property } from "@mikro-orm/decorators/legacy";

/**
 * API token (`aq_<id>_<secret>`) for MCP clients. `id` is the public part of the key; only the hash of the whole key
 * (`ApiKeyProvider.generate()`) is kept.
 */
@Entity({ tableName: "api_tokens" })
export class ApiTokenEntity {
	@PrimaryKey({ type: "string" })
	id!: string;

	@Property({ type: "string", fieldName: "user_id" })
	userId!: string;

	@Property({ type: "string" })
	name!: string;

	@Property({ type: "string", fieldName: "token_hash" })
	tokenHash!: string;

	@Property({ type: "number", fieldName: "created_at" })
	createdAt!: number;

	@Property({ type: "number", fieldName: "expires_at", nullable: true })
	expiresAt: number | null = null;
}
