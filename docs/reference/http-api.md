# HTTP API reference

The server exposes one HTTP surface on a single port: the web UI, the JSON API used by the UI, a server-sent events
stream, the MCP endpoint and a health probe. This page lists every route.

The API is the contract between the server and its own UI. It is stable enough to script against (see
[Answering without a browser](#answering-without-a-browser)), but it is not versioned. Agents should use the
[MCP tools](mcp-tools.md) instead.

## Conventions

| Topic          | Rule                                                                                                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Format         | JSON request and response bodies, UTF-8. Timestamps are integers: milliseconds since the Unix epoch.                                                                          |
| Caching        | Responses under `/api/` and `/auth/` carry `Cache-Control: no-store`.                                                                                                          |
| Error body     | `{ "error": "<message>", "details": ["<detail>", ...] }`. `details` is present only for validation errors. Messages are in French.                                            |
| Identifiers    | Session ids are UUIDs, user ids are UUIDs. Token ids are 16 hex characters.                                                                                                    |
| Pagination     | Cursor in the `before` query parameter, page size fixed at 50. See [Pagination](#pagination).                                                                                  |
| Ownership      | A user only sees their own sessions. A session of another user is `404`, never `403`.                                                                                          |

### Authentication columns

| Label              | Meaning                                                                                                                                                              |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public             | No credential needed.                                                                                                                                                |
| UI session         | Server profile: the session cookie obtained by `POST /auth/login` (or by accepting an invitation). Local profile: nothing, every request is the local user.           |
| UI session, admin  | As above, and the user has the role `admin` (the local user is an admin). Otherwise `403` `Droits insuffisants`.                                                     |
| API token          | `Authorization: Bearer aq_<id>_<secret>`, server profile only. Accepted **only** on `/mcp`; every UI route answers `401` to a token.                                  |

Missing or invalid credentials give `401` (with the header `WWW-Authenticate: Bearer realm="agent-questions"` when the
refusal comes from the application's own checks). Clients should rely on the status code.

### Cross-cutting checks

Applied before routing, in this order:

1. **Host check**: the `Host` header must be one of the accepted hosts (see [Configuration](configuration.md#network-and-security)).
   Otherwise `403 {"error":"Host non autorisé"}`.
2. **Origin check**: if an `Origin` header is present it must be an accepted origin. Otherwise
   `403 {"error":"Origin non autorisée"}`.
3. **CSRF** (writes): a state-changing request that a browser declares as coming from another site (`Sec-Fetch-Site`
   other than `same-origin`, or an untrusted `Origin`) is refused with `403`, even with a valid cookie. Clients that send
   neither header (curl, MCP clients) pass. Trusted origins: the server itself, `AQ_ALLOWED_ORIGINS`, and the dev-server
   origins when `AQ_DEV=1`.
4. **CORS**: for the accepted origins, with credentials, methods `GET POST PUT PATCH DELETE OPTIONS`, request headers
   `content-type`, `accept`, `authorization`, `mcp-protocol-version`, `mcp-session-id`, `last-event-id`, preflight cache
   600 s. A preflight must carry `Access-Control-Request-Method`. This also applies to `/mcp`.

Responses to `401` and `403` are logged at `warn` (method and path only, never credentials). With `AQ_LOG=debug` each request
is also logged, with the invitation token masked in `/auth/invitations/<token>`.

### Pagination

Listing history and the admin session list return a page and a cursor:

```json
{ "items": [], "nextBefore": "1760000000000:0b7e2c1a-4f3d-4c55-9a11-123456789abc" }
```

- Pass `?before=<nextBefore>` to get the next page. Omit it for the first page.
- `nextBefore` is `null` on the last page.
- `before` is an opaque string `<ms>:<id>` and must match `^\d{1,16}:[A-Za-z0-9_-]{1,64}$`, otherwise
  `400 {"error":"Curseur invalide"}`. A bare timestamp (the format used before this change) is rejected.
- The cursor is the keyset `(timestamp, id)` of the last item, compared strictly in descending order. For
  `GET /api/sessions/history` the timestamp is the **closing** time (`answeredAt`); for `GET /api/admin/sessions` it is the
  **creation** time (`createdAt`). The id breaks ties, so sessions sharing the same millisecond are never skipped or
  repeated at a page boundary.

## Route index

| Method and path                         | Authentication     | Purpose                                              |
| --------------------------------------- | ------------------ | ---------------------------------------------------- |
| `GET /health`                           | Public             | Liveness and database check                          |
| `POST /mcp`                             | API token or local | MCP endpoint, see [MCP tools](mcp-tools.md)          |
| `POST /auth/login`                      | Public             | Sign in (server profile)                             |
| `POST /auth/logout`                     | Public             | Sign out                                             |
| `GET /auth/me`                          | UI session         | Current identity                                     |
| `GET /auth/invitations/:token`          | Public             | Look up an invitation                                |
| `POST /auth/invitations/:token`         | Public             | Accept an invitation (choose a password)             |
| `GET /api/sessions`                     | UI session         | Pending sessions                                     |
| `GET /api/sessions/history`             | UI session         | Closed sessions, paginated                           |
| `GET /api/sessions/:id`                 | UI session         | One session                                          |
| `PUT /api/sessions/:id/draft`           | UI session         | Save the draft                                       |
| `POST /api/sessions/:id/answers`        | UI session         | Submit the answers                                   |
| `POST /api/sessions/:id/decline`        | UI session         | Decline to answer                                    |
| `GET /api/events`                       | UI session         | Server-sent events                                   |
| `POST /api/account/password`            | UI session         | Change own password                                  |
| `GET /api/account/tokens`               | UI session         | List own API tokens                                  |
| `POST /api/account/tokens`              | UI session         | Create an API token                                  |
| `DELETE /api/account/tokens/:id`        | UI session         | Revoke an API token                                  |
| `GET /api/admin/users`                  | UI session, admin  | List accounts                                        |
| `POST /api/admin/users`                 | UI session, admin  | Create an account and its invitation                 |
| `POST /api/admin/users/:id/invitation`  | UI session, admin  | Issue a new invitation link                          |
| `PATCH /api/admin/users/:id`            | UI session, admin  | Change role or disable/enable                        |
| `GET /api/admin/sessions`               | UI session, admin  | All sessions of all users, read-only                 |
| `GET /api/admin/sessions/:id`           | UI session, admin  | One session of any user, read-only                   |

Routes under `/auth`, `/api/account` and `/api/admin/users` need accounts. In the local profile they answer
`404 {"error":"Les comptes ne sont disponibles qu'en profil server"}`, except `GET /auth/me` and `POST /auth/logout`.
Every `/auth/invitations/*` call also answers that `404` in the local profile (a malformed body is reported first, with `400`).

## Health

### `GET /health`

Public, used by the Docker health check. Provided by `@nestjs/terminus`.

- `200` when the database answers:

```json
{ "status": "ok", "info": { "database": { "status": "up" } } }
```

(`terminus` also returns the standard `error` and `details` members.)

- `503` when the database does not answer, or while the server shuts down:
  `{ "status": "error", "error": { "database": { "status": "down" } } }` (plus `info` and `details`).

## Unknown routes

Any method on `/api`, `/api/*`, `/auth`, `/auth/*`, `/mcp/*`, `/.well-known` and `/.well-known/*` that no route handles
answers:

```
404 {"error":"Route introuvable"}
```

without authentication and without `WWW-Authenticate`. This is deliberate: the web UI is a single-page app and the
server returns `index.html` for any other unknown path, which would hand HTML to an API client; and a `401` would make an
MCP client start OAuth discovery. Paths outside these prefixes (for example `/foo`) return the UI page when the UI is
built, so `GET /s/<id>` and `GET /invite/<token>` are UI routes, not API routes.

## Authentication routes

### `POST /auth/login`

Server profile only (`404` in the local profile). Public.

Body:

```json
{ "username": "alice", "password": "correct horse battery" }
```

| Field      | Type   | Bounds        |
| ---------- | ------ | ------------- |
| `username` | string | 1 to 100      |
| `password` | string | 1 to 200      |

| Status | When                                                                                                                       |
| ------ | -------------------------------------------------------------------------------------------------------------------------- |
| `200`  | `{"ok":true}` and a `Set-Cookie` session cookie (`HttpOnly`, `SameSite=Lax`, `Secure` when `AQ_PUBLIC_URL` is HTTPS).      |
| `400`  | Invalid body (`Requête invalide`, with `details`).                                                                         |
| `401`  | `Identifiant ou mot de passe incorrect` ("Wrong username or password"). Same answer for an unknown account, a disabled account, a pending invitation and a wrong password. |
| `403`  | Request declared cross-site by the browser (CSRF).                                                                         |
| `429`  | `Trop de tentatives de connexion. Réessayez dans quelques minutes.`                                                        |

Rate limit: 10 failed attempts per 15 minutes, counted per lower-cased user name and per client address (see
`AQ_TRUST_PROXY`). Once reached, even the right password is refused until old attempts age out. The counters are in
memory (reset at restart) and cover at most 10,000 keys. A success clears the user counter.

The cookie lasts at most 7 days and expires after 1 day without activity.

### `POST /auth/logout`

Public. Always answers `200 {"ok":true}`. Ends the server-side session, closes the event streams opened with it and clears
the cookie (also when the session had already expired).

### `GET /auth/me`

UI session. Returns the caller identity:

```json
{ "mode": "server", "userId": "0b9d0c5e-1c1e-4c70-8d3a-5a1f9c1f2b11", "username": "alice", "role": "member" }
```

`mode` is `local` or `server`. In the local profile: `{"mode":"local","userId":"local","username":"local","role":"admin"}`.

### `GET /auth/invitations/:token`

Public. `200 {"username":"alice"}` for a valid, unexpired invitation of an enabled account. Otherwise
`404 {"error":"Invitation invalide ou expirée"}`.

### `POST /auth/invitations/:token`

Public. Body `{ "password": "<10 to 200 characters>" }`. On success the password is set, the invitation is consumed,
all earlier sessions and event streams of the account are closed, the user is signed in (cookie set) and the answer is
`200 {"ok":true}`.

| Status | When                                                              |
| ------ | ----------------------------------------------------------------- |
| `200`  | Password set, signed in.                                          |
| `400`  | Password shorter than 10 or longer than 200 characters.           |
| `404`  | `Invitation invalide ou expirée` (unknown, expired, used, replaced by a newer link, or account disabled). |

An invitation link is `{AQ_PUBLIC_URL}/invite/<token>`, valid 7 days, single use. Only its SHA-256 is stored.

## Sessions (question forms)

A session is one set of questions sent by an agent. Shapes come from `packages/shared/src/views.ts`.

### `SessionSummary`

```json
{
	"id": "6f1d3c1e-9d3b-4a53-9c1e-0f4f5f6a7b8c",
	"title": "Database choice",
	"status": "pending",
	"createdAt": 1760000000000,
	"answeredAt": null,
	"questionCount": 2
}
```

`status` is `pending`, `answered` or `declined`. `answeredAt` is the closing time (answer or decline), `null` while pending.

### `SessionView`

```json
{
	"id": "6f1d3c1e-9d3b-4a53-9c1e-0f4f5f6a7b8c",
	"title": "Database choice",
	"status": "pending",
	"revision": 0,
	"questions": [
		{
			"id": "db",
			"prompt": "Which database?",
			"type": "single",
			"options": [
				{ "id": "pg", "label": "PostgreSQL" },
				{ "id": "sqlite", "label": "SQLite" }
			]
		}
	],
	"draft": {},
	"answers": null,
	"declineReason": null
}
```

`questions` use the [Question](mcp-tools.md#question) shape. `revision` is incremented each time the agent edits the
questions. `draft` and `answers` map a question id to an Answer:

```json
{ "selected": ["pg"], "text": "", "notes": { "pg": "Already used for billing." } }
```

| Answer field | Type                       | Default | Bounds                          |
| ------------ | -------------------------- | ------- | ------------------------------- |
| `selected`   | array of option ids        | `[]`    | At most 50 items                |
| `text`       | string                     | `""`    | At most 50,000 characters       |
| `notes`      | object, option id to string | absent | Each note at most 5,000 characters |

### `GET /api/sessions`

UI session. Pending sessions of the caller, newest first, as an array of `SessionSummary` (no pagination).

### `GET /api/sessions/history`

UI session. Closed (`answered` or `declined`) sessions of the caller, most recently closed first. Query `before`
(optional). Returns `{ "items": SessionSummary[], "nextBefore": string | null }`, 50 per page. `400 Curseur invalide` on a
bad cursor.

### `GET /api/sessions/:id`

UI session. `200 SessionView`, or `404 {"error":"Session introuvable"}` (unknown or not yours). It never writes to the
database, so it is safe to poll (the UI polls it every 5 seconds).

### `PUT /api/sessions/:id/draft`

UI session. Saves the in-progress answers. Body: a map of question id to Answer.

```json
{ "db": { "selected": ["pg"], "text": "" } }
```

| Status | When                                                          |
| ------ | ------------------------------------------------------------- |
| `200`  | `{"ok":true}`.                                                |
| `400`  | `Brouillon invalide`: the body does not match the Answer map. The content is not checked against the questions. |
| `404`  | `Session introuvable`.                                        |
| `409`  | `Cette session est déjà clôturée.`                            |

### `POST /api/sessions/:id/answers`

UI session. Submits the final answers; the waiting `ask_user` or `get_answers` call wakes up. Body: same map as the draft.

| Status | When                                                                                         |
| ------ | -------------------------------------------------------------------------------------------- |
| `200`  | `{"ok":true}`. The session becomes `answered`.                                               |
| `400`  | `Réponses invalides`: body is not an Answer map.                                             |
| `404`  | `Session introuvable`.                                                                       |
| `409`  | `Cette session est déjà clôturée.`                                                           |
| `422`  | `{"error":"Réponses invalides","details":[...]}`: the answers do not satisfy the questions.  |

Validation rules (against the current version of the questions):

- Every required question (`required` not `false`) must be answered. `text`: non-blank text. `single`/`multi`: at
  least one selected option, or non-blank text when the question allows "other" (`allow_other` not `false`).
  Message: `Réponse manquante : <header or id>`.
- Each selected id must be an option of the question: `Option inconnue « <id> » pour <question>`.
- `single` accepts at most one selected option: `Une seule option attendue pour <question>`.
- A note must refer to a selected option: `Note sans option choisie « <id> » pour <question>`. When `allow_notes` is
  `false`, a non-blank note is refused: `Notes non autorisées pour <question>`.
- Every key must be a known question id: `Question inconnue : <id>`.

### `POST /api/sessions/:id/decline`

UI session. Body (optional): `{ "reason": "<at most 2000 characters>" }`, default empty. `200 {"ok":true}` and the session
becomes `declined`. `400 Refus invalide`, `404`, `409` as above.

### Answering without a browser

```bash
curl -s -X POST http://127.0.0.1:4317/api/sessions/<session_id>/answers \
  -H 'Content-Type: application/json' \
  -d '{"db":{"selected":["pg"],"text":""}}'
```

In the server profile add the session cookie (`-H 'Cookie: ...'`); an API token does not work here.

## Events

### `GET /api/events`

UI session. A server-sent events stream (`Content-Type: text/event-stream`) that tells an open UI tab about new
question sessions. Events are partitioned per user: a tab only receives the announcements of its own user.

| Frame                                    | When                                                                                                                      |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `: connecté` (comment)                   | On connection.                                                                                                            |
| `event: new-session` with `data: {"sessionId":"<id>","title":"<title>"}` | An agent created a new session (`ask_user` that created, not resumed). Replayed on connection if announced less than 10 s ago. |
| `: keepalive` (comment)                  | Every 15 seconds.                                                                                                         |

The stream is closed by the server when the user signs out, the account is disabled, the password is changed (other
sessions only), an invitation is accepted, the cookie session expires, or the server stops. There is no event for
`update_questions`: the page notices the new `revision` by polling `GET /api/sessions/:id`.

## Account routes (server profile)

All need a UI session. In the local profile they answer `404`.

### `POST /api/account/password`

Body `{ "current": "<password>", "next": "<10 to 200 characters>" }`.

| Status | When                                                                                                |
| ------ | --------------------------------------------------------------------------------------------------- |
| `200`  | `{"ok":true}`. Every other session of the user is revoked and its event streams closed.              |
| `400`  | Invalid body.                                                                                       |
| `403`  | `Mot de passe actuel incorrect`.                                                                    |
| `429`  | Too many attempts (same limiter as login: 10 per 15 minutes).                                       |

### `GET /api/account/tokens`

Own API tokens, newest first: `[{ "id": "...", "name": "...", "createdAt": 1760000000000 }]`. The secret is never returned
again.

### `POST /api/account/tokens`

Body `{ "name": "Claude Code" }` (trimmed, 1 to 60 characters). `201`:

```json
{
	"id": "0123456789abcdef",
	"name": "Claude Code",
	"createdAt": 1760000000000,
	"token": "aq_0123456789abcdef_<secret>"
}
```

`token` is shown once; only its SHA-256 hash is stored. It expires after one year and is accepted only on `/mcp`.
`409 Limite de 20 jetons atteinte : révoquez-en un.` when the user already has 20 tokens. `400` on an invalid name.

### `DELETE /api/account/tokens/:id`

`200 {"ok":true}`, or `404 {"error":"Jeton introuvable"}` (unknown, or belonging to another user). Revoked tokens are
refused on `/mcp` immediately.

## Administration routes (server profile, admin)

### `UserSummary`

```json
{
	"id": "0b9d0c5e-1c1e-4c70-8d3a-5a1f9c1f2b11",
	"username": "alice",
	"role": "member",
	"disabled": false,
	"pending": true,
	"createdAt": 1760000000000
}
```

`pending` is true until the invited person has chosen a password.

### `GET /api/admin/users`

All accounts, oldest first (then by user name): `UserSummary[]`.

### `POST /api/admin/users`

Body:

| Field      | Type                       | Default  | Rules                                                                                            |
| ---------- | -------------------------- | -------- | ------------------------------------------------------------------------------------------------ |
| `username` | string                     |          | Trimmed, 3 to 40 characters, `^[A-Za-z0-9][A-Za-z0-9._-]*$`. Unique, case-insensitive.            |
| `role`     | `"admin"` or `"member"`    | `member` |                                                                                                  |

`201`:

```json
{
	"user": { "id": "...", "username": "bob", "role": "member", "disabled": false, "pending": true, "createdAt": 1760000000000 },
	"inviteUrl": "https://questions.example.com/invite/<token>",
	"expiresAt": 1760604800000
}
```

The link is returned only once; pass it to the person. `400` on invalid fields, `409 Cet identifiant est déjà utilisé`.

### `POST /api/admin/users/:id/invitation`

No body. `201` with the same `UserInvitation` object, with a **new** link; the previous link stops working. Use it for an
expired invitation or a forgotten password (accepting it sets a new password). `404 Compte introuvable`.

### `PATCH /api/admin/users/:id`

Body: `{ "role"?: "admin" | "member", "disabled"?: boolean, "revokeTokens"?: boolean }`, at least one of `role` / `disabled`
(else `400`, detail `corps : Rien à modifier`). `200` with the updated `UserSummary`.

- Disabling an account closes its sessions and event streams, deletes its pending invitations, and makes its API tokens
  unusable while it stays disabled. With `"disabled": true` and `"revokeTokens": true`, its API tokens are also deleted
  (re-enabling does not bring them back). `revokeTokens` is ignored without `disabled: true`; it defaults to `false`.
- `409 Il doit rester au moins un administrateur actif` when the change would leave no enabled admin.
- `404 Compte introuvable`.

### `GET /api/admin/sessions`

All sessions of all users (any status), newest created first, 50 per page, query `before` (cursor, creation time). Read-only
supervision. Each read is logged at `info` (`supervision` logger) with the admin's name.

```json
{
	"items": [
		{
			"id": "6f1d3c1e-9d3b-4a53-9c1e-0f4f5f6a7b8c",
			"title": "Database choice",
			"status": "pending",
			"createdAt": 1760000000000,
			"answeredAt": null,
			"questionCount": 2,
			"ownerId": "0b9d0c5e-1c1e-4c70-8d3a-5a1f9c1f2b11",
			"ownerUsername": "alice"
		}
	],
	"nextBefore": null
}
```

### `GET /api/admin/sessions/:id`

`SessionView` plus `"readOnly": true`, `ownerId` and `ownerUsername`. `404 Session introuvable`. An admin can read the
session of any user but cannot answer, edit or decline it: the write routes above are limited to the owner.

## MCP endpoint

`POST /mcp` is served by `@nestjs/mcp` (stateless Streamable HTTP). It goes through the same Host, Origin and CORS
checks. It accepts only an API token (server profile) or the local user; a session cookie is refused with `401`. Tools,
parameters and results: [MCP tools](mcp-tools.md). Other methods on `/mcp` are handled by the MCP library and are not
covered here.

## Related

- [MCP tools](mcp-tools.md)
- [Configuration](configuration.md)
- [Data model](data-model.md)
- [Security](../operations/security.md)
