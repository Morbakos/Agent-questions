import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post } from "@nestjs/common";
import { CurrentSession, type SessionRecord } from "@nestjs/authentication";
import {
	type ApiTokenSummary,
	ChangePasswordSchema,
	CreateApiTokenSchema,
	type CreatedApiToken,
	CreateUserSchema,
	UpdateUserSchema,
	type UserInvitation,
	type UserSummary,
} from "@agent-questions/shared";
import { AccountsService } from "@app/auth/accounts.service.js";
import type { Principal } from "@app/auth/domain/principal.js";
import { CurrentPrincipal } from "./current-principal.js";
import { Roles } from "./roles.decorator.js";
import { SessionOnly } from "./session-only.decorator.js";
import { parseBody } from "./validate.js";

/** Account of the signed-in user: password and personal tokens (for MCP clients). */
@SessionOnly()
@Controller("api/account")
export class AccountController {
	constructor(@Inject(AccountsService) private readonly accounts: AccountsService) {}

	@HttpCode(200)
	@Post("password")
	async changePassword(
		@CurrentPrincipal() principal: Principal,
		@Body() body: unknown,
		@CurrentSession() session: SessionRecord | null,
	): Promise<{ ok: true }> {
		const { current, next } = parseBody(ChangePasswordSchema, body);
		await this.accounts.changePassword(principal, current, next, session?.id);
		return { ok: true };
	}

	@Get("tokens")
	tokens(@CurrentPrincipal() principal: Principal): Promise<ApiTokenSummary[]> {
		return this.accounts.listTokens(principal);
	}

	@Post("tokens")
	createToken(@CurrentPrincipal() principal: Principal, @Body() body: unknown): Promise<CreatedApiToken> {
		const { name } = parseBody(CreateApiTokenSchema, body);
		return this.accounts.createToken(principal, name);
	}

	@HttpCode(200)
	@Delete("tokens/:id")
	async revokeToken(@CurrentPrincipal() principal: Principal, @Param("id") id: string): Promise<{ ok: true }> {
		await this.accounts.revokeToken(principal, id);
		return { ok: true };
	}
}

/** Account management, reserved for administrators. */
@SessionOnly()
@Roles("admin")
@Controller("api/admin/users")
export class AdminUsersController {
	constructor(@Inject(AccountsService) private readonly accounts: AccountsService) {}

	@Get()
	list(): Promise<UserSummary[]> {
		return this.accounts.list();
	}

	/** Creates the account without a password and returns the invitation link (to hand to the person). */
	@Post()
	create(@Body() body: unknown): Promise<UserInvitation> {
		const { username, role } = parseBody(CreateUserSchema, body);
		return this.accounts.createUser(username, role);
	}

	/** New invitation link: expired invitation, or forgotten password. The old link stops working. */
	@Post(":id/invitation")
	invite(@Param("id") id: string): Promise<UserInvitation> {
		return this.accounts.invitationFor(id);
	}

	@Patch(":id")
	update(@Param("id") id: string, @Body() body: unknown): Promise<UserSummary> {
		return this.accounts.update(id, parseBody(UpdateUserSchema, body));
	}
}
