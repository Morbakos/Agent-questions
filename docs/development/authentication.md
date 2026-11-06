# Authentication

Authentication is built on `@nestjs/authentication` (pinned to `0.1.4`: it is a 0.x package, read its changelog before bumping). The package provides the global guard, sessions, cookies, API keys, CSRF handling and password hashing. This repository adds accounts, roles, invitations and the login throttle.

For the user-facing side, see [Accounts and roles](../guide/accounts-and-roles.md) and the [security guide](../operations/security.md).

## Model

- The authenticated user is a `Principal` (`auth/domain/principal.ts`): `{ userId, username, role }`. It is set on `request.user` by the guard and read with `@CurrentUser()` (re-exported as `@CurrentPrincipal()`).
- **Never read the owner or role from a body, a query string or a header.** An e2e test checks that `X-User` / `X-Tenant` headers are ignored.
- The owner of a tool call is `context.request.user`. In the `local` profile with no request at all (the in-memory test client), the owner falls back to the local user.

## Providers

The package guard protects every route unless it is `@Public()`. It tries the registered providers in order. Which ones are registered depends on the profile:

| Provider      | Profiles | Order | Identity                                                                    |
| ------------- | -------- | ----- | --------------------------------------------------------------------------- |
| `SessionAuth` | server   | 0     | Session cookie (browser). Deactivated or deleted account ends the session   |
| `ApiKeyAuth`  | server   | 1     | `Authorization: Bearer aq_<id>_<secret>` (MCP clients)                      |
| `LocalAuth`   | local    | 0     | Fixed user `local` with role `admin`, for any request                       |

The `local` profile only listens on loopback (or on `0.0.0.0` inside a container with the port published on the host's loopback), which is why `LocalAuth` can accept every request.

## Which routes accept what

| Decorator                | Effect                                                                                                                                  |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| (none)                   | Any registered provider. Do not rely on this for UI routes                                                                              |
| `@Public()`              | No authentication: `/health`, login, logout, invitations, `UnknownRouteController`                                                      |
| `@SessionOnly()`         | `Authenticate({ providers: [SessionAuth, LocalAuth] })`: browser identities only, **an API token is refused (401)**                     |
| `@Roles("admin")`        | `RolesGuard`: 403 for other roles. Runs after the global guard, so the user is known                                                    |

The module for MCP does the opposite: `McpModule.forRoot({ decorators: [Authenticate({ providers: [ApiKeyAuth, LocalAuth] })] })`, so `/mcp` accepts API tokens and the local user, and never the session cookie.

Why `@SessionOnly()` exists: without it the global guard would accept an API token on any route. A leaked MCP client configuration would then open the UI's API, user administration and token management. **Every controller that serves the UI must carry `@SessionOnly()`.** A test in `auth.e2e-spec.ts` checks that a valid and an invalid API token get 401 on a hand-written list of UI routes; add your route to that list.

`@Roles("admin")` is only a role check. Data isolation does not depend on it: it comes from the owner filter in the repositories. Admins can read every session through `/api/admin/sessions` (read-only) and each such read is logged.

## Sessions and cookies

`AuthModule.register(config)` configures `AuthenticationModule.forRoot`:

- Absolute lifetime 7 days, idle lifetime 1 day.
- `cookie.secure` is true when `AQ_PUBLIC_URL` starts with `https:`. The cookie is `HttpOnly` and `SameSite=Lax`. It is named `__Host-sid` (requires HTTPS); over plain HTTP outside localhost it is `sid`.
- Sessions are stored in the `auth_sessions` table by `MikroAuthSessionStore`, which joins the user to the session (`SessionRecord.extra.user`). The store is verified with the package's `authenticationStoreContract()`.
- Signing in is `SignInService.signIn(userId, { method })` after `AuthService.verifyCredentials`. It refuses a sign-in started from another origin.
- On `sign-out` events (sign-out, revoking a session, "sign out everywhere"), `AuthEventsBridge` closes the matching SSE streams in `UiHub`.

Deactivating an account, accepting an invitation and changing a password revoke sessions (`SessionService.revokeAll`) and close the user's SSE streams; changing a password keeps the current session.

## CSRF

`app.enableCsrfProtection({ trustedOrigins })` checks `Sec-Fetch-Site` and `Origin` on state-changing requests. A write that a browser says comes from another site is refused with 403. Clients without a browser (MCP agents, curl) send neither header and pass. The UI therefore needs no CSRF token.

Trusted origins are `trustedOriginsOf(config)`: `http://localhost:4200` and `http://127.0.0.1:4200` when `AQ_DEV=1`, plus `AQ_ALLOWED_ORIGINS`. The server's own origin is always trusted. This is separate from the Host/Origin guard in `http-setup.ts` (DNS rebinding) and from CORS.

## Accounts and invitations

`AccountsService` (server profile only; it answers 404 in the local profile) implements:

- **First admin.** `AuthService.onApplicationBootstrap` creates it when the server profile starts with no user: `AQ_ADMIN_USERNAME` (default `admin`) and `AQ_ADMIN_PASSWORD`. Without a password, a random one is generated and logged once at `warn` level. Sessions created before accounts existed (owner `local`) are reassigned to this first admin.
- **Invitations.** An admin creates a user with no password; the response carries `inviteUrl` (`<AQ_PUBLIC_URL>/invite/<token>`) shown once. The token is 256 random bits; only its SHA-256 hash is stored (`tokens.ts`, `invitations` table). It is valid 7 days and single use. A new invitation replaces the previous one. Accepting it sets the password, signs the user in and revokes older sessions.
- **Guard rails.** At least one enabled admin must remain (409 otherwise). Usernames are unique case-insensitively.
- **API tokens.** Format `aq_<id>_<secret>`, generated by `ApiKeyAuth.generate()`. Only the hash is stored. The package compares hashes in constant time; `findKey` looks the key up by its public id and refuses a disabled account. A token expires after one year, and a user can hold at most 20.
- **Password.** Hashed by the package's `PasswordHasher` (scrypt). Length 10 to 200 characters (`PASSWORD_MIN_LENGTH` / `PASSWORD_MAX_LENGTH` in `shared`). Tests replace the hasher with a cheap cost (`new PasswordHasher({ logN: 10 })`).

## Login throttle

`LoginThrottle` is a sliding window in memory: 10 failures per 15 minutes, per username and per client address, then 429 even with the right password. `attempt()` records the try synchronously before any `await`, so a burst of parallel requests cannot all pass the check; `forgive()` removes it after a success. Changing a password has its own throttle on the current-password check (key `password:<userId>`). The state is lost on restart, and the client address depends on `AQ_TRUST_PROXY` (the number of proxies to trust): behind a reverse proxy without it, all clients share the proxy's address and its quota.

Login failures never reveal whether the account exists: an unknown, disabled or password-less account costs the same time as a wrong password (the hasher performs a dummy verification) and returns the same message.

## Logging rules

Never log a password, a cookie or a token. 401 and 403 are logged by `http-setup.ts` with method and path only. `redactUrl` masks the invitation token in `/auth/invitations/<token>`. An e2e test checks that none of these secrets appear in the logs.

## Checklist: touching authentication

- New UI controller: `@SessionOnly()`, `@Roles("admin")` if admin-only, owner taken from `@CurrentPrincipal()`.
- New repository method on sessions: owner first, filtered on it.
- New secret: store a hash, show the clear value once.
- Add or update the e2e test in `packages/server/test/auth.e2e-spec.ts`.
