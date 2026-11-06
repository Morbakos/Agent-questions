import type { Role } from "@agent-questions/shared";
import type { UserRecord } from "@app/auth/domain/user.js";

/** Identity of the caller, independent of the transport (HTTP, SSE, MCP). Established only by authentication. */
export interface Principal {
	userId: string;
	username: string;
	role: Role;
}

/** Owner id of the sessions in the local profile (a single user, no account). */
export const LOCAL_USER_ID = "local";

/** Local profile: a single user, on their own machine, with no account or password. */
export const LOCAL_PRINCIPAL: Principal = Object.freeze({ userId: LOCAL_USER_ID, username: "local", role: "admin" });

/** Identity of an account, as seen by controllers and MCP tools. */
export const toPrincipal = ({ id, username, role }: UserRecord): Principal => ({ userId: id, username, role });
