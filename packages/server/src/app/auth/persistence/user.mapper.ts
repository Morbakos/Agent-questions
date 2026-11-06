import type { UserRecord } from "@app/auth/domain/user.js";
import type { UserEntity } from "@app/auth/persistence/entities/user.entity.js";

/** `users` entity to domain type. Shared by the two MikroORM adapters that read accounts. */
export const toUser = ({ id, username, passwordHash, role, disabled, createdAt }: UserEntity): UserRecord => ({
	id,
	username,
	passwordHash,
	role,
	disabled,
	createdAt,
});
