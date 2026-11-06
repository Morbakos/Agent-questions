import type { Principal } from "@app/auth/domain/principal.js";
import type { UserRecord } from "@app/auth/domain/user.js";

declare module "@nestjs/authentication" {
	/**
	 * Application types for `@nestjs/authentication`: the user seen by `@CurrentUser()` and `request.user` is a
	 * `Principal`, and the session store joins the account to the session (`SessionRecord.extra`).
	 */
	interface AuthenticationTypes {
		user: Principal;
		sessionExtra: { user: UserRecord };
	}
}
