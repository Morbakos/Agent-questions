import { Authenticate } from "@nestjs/authentication";
import { LocalAuth } from "@app/auth/providers/local-auth.js";
import { SessionAuth } from "@app/auth/providers/session-auth.js";

/**
 * Restricts a route (or controller) to UI identities: session cookie, or local user. An API token is meant for `/mcp`
 * only: without this decorator, the global guard would accept any registered provider, so a leaked MCP client
 * configuration would open the UI API, administration and tokens.
 */
export const SessionOnly = () => Authenticate({ providers: [SessionAuth, LocalAuth] });
