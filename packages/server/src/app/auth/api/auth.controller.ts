import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req, Res } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { Public, SessionService, SignInService } from "@nestjs/authentication";
import { AcceptInvitationSchema, type AuthMe, type InvitationInfo, LoginSchema } from "@agent-questions/shared";
import { AccountsService } from "@app/auth/accounts.service.js";
import type { Principal } from "@app/auth/domain/principal.js";
import { AuthService } from "@app/auth/auth.service.js";
import { CurrentPrincipal } from "./current-principal.js";
import { SessionOnly } from "./session-only.decorator.js";
import { parseBody } from "./validate.js";

/** Sign-in, sign-out, current identity and invitation acceptance. */
@SessionOnly()
@Controller("auth")
export class AuthController {
	constructor(
		@Inject(AuthService) private readonly auth: AuthService,
		@Inject(AccountsService) private readonly accounts: AccountsService,
		@Inject(SignInService) private readonly signIn: SignInService,
		@Inject(SessionService) private readonly sessions: SessionService,
	) {}

	/** The session cookie is set by `SignInService`, which also refuses a sign-in started from another origin. */
	@Public()
	@HttpCode(200)
	@Post("login")
	async login(@Body() body: unknown, @Req() request: FastifyRequest): Promise<{ ok: true }> {
		this.accounts.requireServer();
		const { username, password } = parseBody(LoginSchema, body);
		await this.signIn.signIn(await this.auth.verifyCredentials(username, password, request.ip), {
			method: "password",
		});
		return { ok: true };
	}

	@Public()
	@HttpCode(200)
	@Post("logout")
	async logout(@Res({ passthrough: true }) reply: FastifyReply): Promise<{ ok: true }> {
		// Without a valid session (expired, malformed cookie), `signOut` leaves the cookie alone: clear it anyway.
		if (!(await this.signIn.signOut())) {
			reply.header("set-cookie", this.sessions.clearCookie());
		}
		return { ok: true };
	}

	@Get("me")
	me(@CurrentPrincipal() principal: Principal): AuthMe {
		return { mode: this.auth.mode, ...principal };
	}

	@Public()
	@Get("invitations/:token")
	invitation(@Param("token") token: string): Promise<InvitationInfo> {
		return this.accounts.invitationInfo(token);
	}

	@Public()
	@HttpCode(200)
	@Post("invitations/:token")
	async acceptInvitation(@Param("token") token: string, @Body() body: unknown): Promise<{ ok: true }> {
		const { password } = parseBody(AcceptInvitationSchema, body);
		const user = await this.accounts.acceptInvitation(token, password);
		await this.signIn.signIn(user.id, { method: "invitation" });
		return { ok: true };
	}
}
