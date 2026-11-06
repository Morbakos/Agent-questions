import type { Role } from "@agent-questions/shared";

/** Stored account. `createdAt` is in milliseconds since the epoch. */
export interface UserRecord {
	id: string;
	username: string;
	/** `null` until the invitee has chosen a password. */
	passwordHash: string | null;
	role: Role;
	disabled: boolean;
	createdAt: number;
}

/** Listable part of an API token: never carries the secret nor its hash. */
export interface ApiTokenRecord {
	id: string;
	name: string;
	createdAt: number;
}

/** API token as storage returns it: its hash, its owner and its expiry (`null`: none). */
export interface StoredApiKey {
	tokenHash: string;
	user: UserRecord;
	expiresAt: number | null;
}
