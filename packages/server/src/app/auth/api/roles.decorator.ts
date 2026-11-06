import { SetMetadata, UseGuards, applyDecorators } from "@nestjs/common";
import type { Role } from "@agent-questions/shared";
import { ROLES, RolesGuard } from "./roles.guard.js";

/**
 * Restricts a route to the given roles (403 otherwise). Without this decorator, any authenticated account may call it.
 * The guard is set on the route: it always runs after the global authentication guard, which established the user.
 */
export const Roles = (...roles: Role[]) => applyDecorators(SetMetadata(ROLES, roles), UseGuards(RolesGuard));
