import { Entity, PrimaryKey, Property } from "@mikro-orm/decorators/legacy";

/** Invitation to choose a password: only the hash of the token is kept. */
@Entity({ tableName: "invitations" })
export class InvitationEntity {
	@PrimaryKey({ type: "string", fieldName: "token_hash" })
	tokenHash!: string;

	@Property({ type: "string", fieldName: "user_id" })
	userId!: string;

	@Property({ type: "number", fieldName: "expires_at" })
	expiresAt!: number;
}
