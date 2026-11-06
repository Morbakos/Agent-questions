import { type CanActivate, type ExecutionContext, Inject, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Role } from "@agent-questions/shared";
import { AuthError } from "@app/auth/auth-error.js";
import type { Principal } from "@app/auth/domain/principal.js";

/** Metadata key under which `@Roles()` stores the allowed roles. */
export const ROLES = "aq:roles";

/** Checks the role required by `@Roles()` against the principal that authentication set on the request. */
@Injectable()
export class RolesGuard implements CanActivate {
	constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

	canActivate(context: ExecutionContext): boolean {
		const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES, [
			context.getHandler(),
			context.getClass(),
		]);
		if (!roles) {
			return true;
		}
		const principal = context.switchToHttp().getRequest<{ user?: Principal }>().user;
		if (!principal || !roles.includes(principal.role)) {
			throw new AuthError(403, "Droits insuffisants");
		}
		return true;
	}
}
