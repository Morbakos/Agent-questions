# Architecture

## One process

Everything runs in a single HTTP process: the web UI, the UI's API, the SQLite database and the `/mcp` endpoint. Every agent connects to that same process (a Docker container with `restart: unless-stopped`, or `bun run start` from a clone).

```text
            Agent (Claude Code, Codex, ...)                Browser (Angular UI)
                      |                                           |
        POST /mcp (Streamable HTTP)              /api/*, /auth/*, GET /api/events (SSE), static files
                      |                                           |
        +-------------v-------------------------------------------v--------------+
        |  Fastify + NestJS                                                       |
        |   global auth guard, Host/Origin guard, CSRF, security headers          |
        |                                                                         |
        |   QuestionTools (@Tool)          SessionsController / Admin... / Auth.. |
        |          \                        /                                     |
        |           v                      v                                      |
        |        SessionsService  <---- EventEmitter (in memory) ----> wait()     |
        |           |                                                             |
        |        SessionRepository (abstract)         UiHub (SSE tabs, in memory) |
        |           |                                                             |
        |   MikroSessionRepository --> node:sqlite (one file, WAL)                |
        +-------------------------------------------------------------------------+
```

The constraint that shapes the design: `SessionsService.wait()` is a long-lived call that sleeps on a Node `EventEmitter`. When the user submits answers through the UI's API, `submit()` emits the session id and the sleeping `ask_user` call wakes up. The emitter lives in the memory of this process, so **the UI/API and the MCP handler must stay in the same process**. To split them, replace the emitter first (for example by polling SQLite or using a message bus).

## Flow of an `ask_user` call

1. The agent calls `ask_user` with `questions` (and optionally `title`, `wait_seconds`). The global guard authenticates the request. In the `local` profile the owner is the fixed user `local`; in the `server` profile it is the account behind the API token. The owner never comes from a tool argument.
2. `SessionsService.findOrCreate` hashes the title and questions (SHA-256 of their JSON) and, atomically, returns the owner's reusable session with that hash or creates a new `pending` one. See [idempotent resume](#idempotent-resume).
3. If a session was created, `UiHub.announce(owner, session)` pushes a `new-session` event to that owner's open UI tabs.
4. If the server may open a browser (`AQ_NO_OPEN` unset, `local` profile) and the owner has no connected UI tab, the server opens the session URL.
5. `waitAndRespond` waits for `wait_seconds` (default `AQ_WAIT_SECONDS`, which defaults to 0, meaning "do not wait"), emitting an MCP progress notification every 15 seconds (ignored if the client did not ask for progress).
6. The result is `answered`, `declined` or `pending`. Delivered `answered` and `declined` results set `delivered_at` on the session.

Meanwhile in the browser: the UI receives the SSE event (or finds the session in the list it polls every 5 seconds), shows the form, saves a draft 600 ms after each edit, and on submit calls `POST /api/sessions/:id/answers`. The server validates the answers against the stored questions with the same function the UI uses (`validateAnswers`), closes the session and emits the wake-up event.

```text
Agent                  Server                                  Browser
  | ask_user ---------->| findOrCreate -> announce(new-session) ->| (SSE) navigate / toast
  |                     | wait(session, ms) ... sleeping          |
  |                     |                      PUT .../draft <----| (autosave)
  |                     |                POST .../answers <-------| submit
  |                     | validate, close, emit(id) -> wake       |
  |<-- answered --------| markDelivered                           |
```

If `wait_seconds` is 0 or the delay runs out first, the agent gets `pending` with the `session_id` and the form URL, and fetches the answers later with `get_answers`. Details in [Waiting for answers](waiting-for-answers.md).

## Stateless MCP

The server keeps no MCP protocol session between requests: everything an agent needs lives in SQLite, addressed by `session_id`. An agent can reconnect, restart or call `get_answers` from a different process and still find its session. The `/mcp` route itself is provided by `@nestjs/mcp` (pinned, see [Server](server.md#nest-package-first)); `scripts/verify-package.ts` checks an `initialize` request against it on both Node and Bun.

## Idempotent resume

Agents retry and clients replay calls. To avoid duplicate forms, `findOrCreate` reuses a session of the same owner when:

- the hash of `title` + `questions` matches, and
- the session is still `pending`, or its result has not been delivered yet (`delivered_at` is null).

Changing the title or any question yields a new hash and therefore a new session. Passing `session_id` skips the hash and returns that session as is (404 if it is unknown or belongs to someone else). A user can have at most 100 pending sessions (`MAX_PENDING_PER_OWNER`); beyond that `ask_user` fails with a 409.

`update_questions` is the supported way to edit a pending session: it replaces the questions, recomputes the hash, increments `revision`, and keeps the user's draft for the questions that still exist (minus options that disappeared).

## Live updates: the UI hub

`UiHub` holds the open UI tabs, partitioned by owner. It backs the SSE stream `GET /api/events` (Nest `@Sse()`):

- Each tab is an RxJS `Observable`; the stream sends a `: keepalive` comment every 15 seconds.
- `announce(owner, session)` sends a `new-session` event (`{ sessionId, title }`) to that owner's tabs only. The last announcement is replayed for 10 seconds to a tab that connects just after.
- `hasUi(owner)` is true when a tab is connected, or the server opened one less than 15 seconds ago. `ask_user` uses it to avoid opening a second browser tab.
- Streams close on `sign-out`, account deactivation, password change (except the current session) and at the session expiry. The UI reconnects and must authenticate again.
- On shutdown, `beforeApplicationShutdown` completes every stream, otherwise the HTTP server would wait for each tab to disconnect.

The UI decides what to do with an announcement: see [UI](ui.md#following-the-agent). `update_questions` triggers no event; the open page notices by polling.

## Request pipeline

```text
Fastify onRequest hook      Host and Origin must be known (403 otherwise)
CORS (enableCors)           only allowed origins; also applies to /mcp
CSRF (enableCsrfProtection) browser writes from another origin are refused
Global auth guard           every route needs a provider, except @Public()
@SessionOnly()              UI controllers: cookie or local user, never an API token
@Roles("admin")             admin routes
Controller -> Service -> Repository
Fastify onSend / onResponse no-store on /api and /auth; request log at debug; 401/403 logged
```

Static UI files come from `@nestjs/serve-static` (with `fallthrough: true`, serving `index.html` for Angular routes). That loader ignores its `exclude` option, so `UnknownRouteController` answers a JSON 404 under `/api`, `/auth`, `/mcp/*` and `/.well-known`. Without it an MCP client probing OAuth discovery would receive the UI's HTML or a 401 and abort.

## Single connection, one writer

The SQLite dialect uses one connection. Concurrent repository calls are therefore serialized, which is what makes `findOrCreate` safe. Do not run two server processes on the same data directory. SQLite runs in WAL mode with an aggressive checkpoint so the file stays small (see the [data model](../reference/data-model.md)).

Never write to the database in a route the UI polls (`GET /api/sessions/:id` is read every 5 seconds). That is why it does not update a "last seen" column.
