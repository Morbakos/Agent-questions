import { z } from "zod";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "./limits.js";

/** `admin` creates and manages accounts; `member` (collaborator) uses the application. Finer permissions come later. */
export const RoleSchema = z.enum(["admin", "member"]);
export type Role = z.infer<typeof RoleSchema>;

/** Trimmed 3 to 40 characters, starting with a letter or digit (the username is also the sign-in identifier). */
export const UsernameSchema = z
	.string()
	.trim()
	.min(3)
	.max(40)
	.regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "Lettres, chiffres, point, tiret et tiret bas uniquement");
export const PasswordSchema = z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH);

export const LoginSchema = z.object({
	username: z.string().min(1).max(100),
	password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});
export const AcceptInvitationSchema = z.object({ password: PasswordSchema });
export const ChangePasswordSchema = z.object({
	current: z.string().min(1).max(PASSWORD_MAX_LENGTH),
	next: PasswordSchema,
});
export const CreateUserSchema = z.object({ username: UsernameSchema, role: RoleSchema.default("member") });
/**
 * Partial update of a user; at least one of `role` / `disabled` must be present. `revokeTokens` is only honoured
 * together with `disabled: true`: it also deletes the account's API tokens, so re-enabling it needs new ones.
 */
export const UpdateUserSchema = z
	.object({ role: RoleSchema.optional(), disabled: z.boolean().optional(), revokeTokens: z.boolean().optional() })
	.refine((value) => value.role !== undefined || value.disabled !== undefined, "Rien à modifier");
export const CreateApiTokenSchema = z.object({ name: z.string().trim().min(1).max(60) });

/** Identity of the caller as exposed by `GET /auth/me`. */
export interface AuthMe {
	mode: "local" | "server";
	userId: string;
	username: string;
	role: Role;
}

export interface UserSummary {
	id: string;
	username: string;
	role: Role;
	disabled: boolean;
	/** True until the invitee has chosen a password. */
	pending: boolean;
	createdAt: number;
}

/** Response to an account creation or a new invitation: the link is shown only once. */
export interface UserInvitation {
	user: UserSummary;
	inviteUrl: string;
	/** Link expiry (ms since the epoch). */
	expiresAt: number;
}

/** What an invitation link reveals before it is accepted. */
export interface InvitationInfo {
	username: string;
}

export interface ApiTokenSummary {
	id: string;
	name: string;
	createdAt: number;
}

/** Response to a token creation: the value is never returned again afterwards. */
export interface CreatedApiToken extends ApiTokenSummary {
	token: string;
}
