# Security

This page describes what the server enforces, what it does not, and what you must do as an operator. To report a
vulnerability, see [`SECURITY.md`](../../SECURITY.md).

## Threat model

### Local profile

One trusted user on one machine. There are no accounts: every request is the same implicit user. Protection rests on
the listener being loopback-only (any other `AQ_BIND_HOST` is refused, except `0.0.0.0` inside the official container)
and on the `Host` / `Origin` guard below, which stops a malicious web page from reaching the server through DNS
rebinding or cross-origin requests from the user's browser.

Out of scope: other users or processes on the same machine can use the API and `/mcp`. Never put a proxy, tunnel or
public port in front of this profile.

### Server profile

Several users, possibly hostile to each other, over a network, with the server behind HTTPS. Enforced:

- **Isolation**: every session belongs to its creator. Each repository method takes the owner and filters on it: a
  session of another user is simply not found. The live SSE stream is also partitioned per user.
- **Administrators see everything, read-only.** An admin can list and open every user's sessions, not answer or edit
  them. Each such read is logged (`supervision` logger: `<admin> consulte la liste des sessions...` / `... consulte la
  session <id>`).
- **Agent tokens are narrow**: an API token authenticates `/mcp` only. It cannot call the UI API, manage accounts or
  create tokens.
- **Untrusted agent content**: question text is markdown written by an agent. The UI renders it with `marked` followed
  by Angular's sanitiser and never bypasses it.

Not covered: a malicious administrator with access to the host or the database, a compromised host, and denial of
service by authenticated users.

## Authentication

| Item                | Behaviour                                                                                                |
| ------------------- | -------------------------------------------------------------------------------------------------------- |
| Passwords           | 10 to 200 characters, hashed with the `PasswordHasher` of `@nestjs/authentication` (scrypt)               |
| Unknown accounts    | Cost the same time as a wrong password (dummy verification), same message: no username enumeration       |
| Sign-in throttling  | 10 failed attempts per 15 minutes, counted per username and per client address, then `429`, even with the right password. In memory: reset on restart |
| Sign-in session     | Cookie `__Host-sid` (`sid` when `AQ_PUBLIC_URL` is plain HTTP on a non-localhost host). Absolute lifetime 7 days, idle lifetime 1 day. `Secure` when `AQ_PUBLIC_URL` is HTTPS |
| Invitations         | 256-bit random link `<AQ_PUBLIC_URL>/invite/<token>`, valid 7 days, single use, stored as a SHA-256 hash   |
| API tokens          | `aq_<id>_<secret>`, valid **1 year**, at most 20 per user, shown once, stored hashed, `Authorization: Bearer` |
| Password change     | Requires the current password (also throttled); closes the user's other sessions                          |
| Disabling a user    | Revokes sessions and invitations, closes live streams, and stops the user's API tokens from authenticating; `revokeTokens: true` (the UI's default) also deletes them |
| Last administrator  | Cannot be demoted or disabled (`409`)                                                                    |

Behind a proxy, set `AQ_TRUST_PROXY` correctly or the per-address throttle is shared by everybody
([reverse proxy](reverse-proxy.md)).

## Request guards

- **Host and Origin** (all routes, `onRequest` hook): the `Host` header must be known (`127.0.0.1`, `localhost`,
  `AQ_ALLOWED_HOSTS`, the host of `AQ_PUBLIC_URL`) and, when present, `Origin` must be known (those same hosts, the
  public origin, `AQ_ALLOWED_ORIGINS`, and `localhost:4200` only when `AQ_DEV=1`). Otherwise `403`. `AQ_ALLOWED_ORIGINS`
  takes exact origins and refuses wildcards at startup.
- **CSRF**: `Sec-Fetch-Site` / `Origin` are checked on writes: a browser declaring another origin gets `403`. Clients
  without a browser (agents, curl) send neither header and pass; they are authenticated by token anyway.
- **CORS**: only the origins above, with credentials, on the API and on `/mcp`. A pre-flight needs
  `Access-Control-Request-Method`.
- **Auth guard**: global. Every route needs authentication except those explicitly public (`/health`, sign-in,
  invitation acceptance, unknown-route 404s). Every UI controller is restricted to cookie sessions.
- **Unknown routes** under `/api`, `/auth`, `/mcp/*` and `/.well-known` return a JSON `404` rather than the UI page.

## Response headers

- `Content-Security-Policy`: `default-src 'self'`, `script-src` taken from the UI build (script hash computed by
  Angular's `autoCsp`, otherwise `'self'`), `style-src 'self' 'unsafe-inline'`, `img-src 'self' data:`,
  `object-src 'none'`, `frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'self'`. The server's CSP does not
  include `upgrade-insecure-requests`, so the UI keeps working over HTTP on localhost.
- `X-Frame-Options: DENY`.
- `Strict-Transport-Security: max-age=31536000` only when `AQ_PUBLIC_URL` is HTTPS.
- `Cache-Control: no-store` on everything under `/api/` and `/auth/`.

A proxy that adds its own CSP or removes these headers will weaken or break the UI; if you add headers, test the UI.

## Logging and secrets

- Failed authorisation (`401`, `403`) is logged at `warn` with method and path only (`auth` logger): never a token,
  cookie or password.
- Request lines (`debug` level) hide the secret in `/auth/invitations/<token>` as `[masqué]`.
- Invitation links, API tokens and passwords are not logged. **Exception**: when `AQ_ADMIN_PASSWORD` is not set, the
  generated first-administrator password is written to the logs once. Rotate it right away and purge those logs if
  they are shipped somewhere shared.
- The database stores only hashes of passwords, sessions, invitations and API tokens. Question and answer contents
  are stored in clear text: protect the volume and backups accordingly (see [backup](backup-and-upgrade.md)).

## Hardening checklist

- [ ] `AQ_DEPLOYMENT_MODE=server`, `AQ_PUBLIC_URL` in HTTPS.
- [ ] TLS terminated by a proxy; port 4317 reachable only from the proxy (bind `127.0.0.1` or a private network).
- [ ] `AQ_TRUST_PROXY` equals the real number of proxies.
- [ ] `AQ_ALLOWED_HOSTS` / `AQ_ALLOWED_ORIGINS`: only what you need, exact values, no wildcard.
- [ ] `AQ_DEV` unset in production (it allows `localhost:4200`).
- [ ] The first-administrator password changed, `AQ_ADMIN_PASSWORD` removed from the environment afterwards.
- [ ] One account per person; disable accounts of people who leave; keep at least two administrators.
- [ ] API tokens named per client or machine, revoked when a machine is retired (they expire after a year in any case).
- [ ] Image pinned to a version; upgraded regularly ([backup and upgrade](backup-and-upgrade.md)).
- [ ] Container runs as the image's non-root `bun` user; the data volume is not shared with other services.
- [ ] Backups encrypted and tested; logs retained according to your policy.
