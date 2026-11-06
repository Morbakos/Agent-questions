# Troubleshooting

Each entry is a symptom, its cause and the fix. For more detail from the server, set `AQ_LOG=debug` (HTTP requests are
logged at that level only; 401 and 403 refusals are always logged at `warn` with method and path, never secrets).

## The agent and its answers

### The call times out or the agent says `pending`

Cause: by default `ask_user` does not wait; it returns `pending` at once with a `session_id` and the form URL. It also
returns `pending` when the `wait_seconds` the agent asked for is over, or an error if the client cut the call.

Fix:

- Your answers are not lost. They are stored with your draft even when no call is waiting.
- Tell the agent: "I answered, fetch my answers." It calls `get_answers` with the `session_id`.
- If the client cuts long calls before `wait_seconds`, raise its tool timeout (Codex: `tool_timeout_sec`, 60 s by
  default; Claude Code: idle window of 5 minutes for HTTP servers, see
  [Connect your agent](connect-your-agent.md#tool-call-timeouts)), or let the agent poll with `get_answers`.
- To make the server wait by default, set `AQ_WAIT_SECONDS` (0 to 3600).

### The agent does not know I answered

Cause: nothing notifies the agent of a late answer.

Fix: ask it to call `get_answers`. If it lost the `session_id`, give it the one in the form URL
(`http://127.0.0.1:4317/s/<session_id>`; the same page opens from "Historique"), or ask it to call `ask_user` again with
**exactly the same title and questions**: the server returns the existing session and your answers.

### The agent keeps asking the same questions

Cause: the agent does not remember the `session_id`, or loops on `get_answers` with `wait_seconds` 0 (it only checks the
current state).

Fix: remind it to reuse the `session_id` and to call `get_answers` with a positive `wait_seconds` only when it cannot
continue. The prompt snippet in [Connect your agent](connect-your-agent.md#3-tell-the-agent-when-to-use-it) prevents most
cases.

### The agent asked again and I got an empty form

Cause: a new session was created because the title or a question changed. Identical title and questions return the
existing session; any rewording creates a new one.

Fix: answer the new one. The old one stays pending in the list: open it and use "Ne pas répondre" to clear it.

### The agent uses `ask_user` to ask me to approve a plan

The tool description tells agents not to. If yours does anyway, add the instruction to your `CLAUDE.md` / `AGENTS.md`
(see [Connect your agent](connect-your-agent.md#3-tell-the-agent-when-to-use-it)).

### `update_questions` fails with "Session already answered" or "declined"

Cause: a closed session cannot be edited.

Fix: the agent should call `get_answers`, then `ask_user` with a new question set if it needs more.

### 413 `Request body is too large`

Cause: the request body exceeds 10 MiB, or a reverse proxy with a lower limit (nginx's default is 1 MiB) rejected it
before it reached the server.

Fix: send less context in `context_markdown`, or raise the proxy limit to at least 10 MiB
([reverse proxy](../operations/reverse-proxy.md#request-size)).

### `Trop de sessions en attente (100)`

Cause: you have 100 pending sessions (HTTP 409). Typically an agent created many without anyone answering.

Fix: answer or decline some from the list ("Ne pas répondre").

## The browser and the UI

### The browser does not open

Causes and fixes:

- `AQ_NO_OPEN=1` is set (always the case in the Docker image) or the profile is `server`: the server never opens a
  browser. The agent should tell you the address; open `AQ_PUBLIC_URL` once and keep the tab open.
- A tab of yours is already connected (or one was opened less than 15 seconds ago): the server does not open a second
  one. The connected tab goes to the new questions itself, or shows a notification if you are filling in another form.
- The server runs on a machine without a display (SSH, a VM): `xdg-open`, `open` or `start` fails silently. Open the
  URL yourself.
- The URL printed by the agent uses `AQ_PUBLIC_URL`. If it is wrong, set it to the address your browser uses.

### I opened the page but my questions do not appear

- The list refreshes every 5 seconds, and not while the tab is hidden. Bring the tab to the foreground.
- Check that you are the same user: in the `server` profile each user sees only their own sessions, and the token the
  agent uses belongs to one user. Questions created through a colleague's token are not yours.
- If the list shows "Impossible de charger les questions (...). Nouvelle tentative automatique." the server is
  unreachable or answered an error: the page retries by itself.

### I am not taken to the new questions

If you are in the middle of a form, the tab shows "Nouvelles questions : <title>" with "Y aller" and "Ignorer" instead of
navigating. In a background tab only the title changes to "(1) Questions de l'agent". If nothing happens at all, the live
connection may be down (it retries every 2 to 60 seconds); reload the page.

### "Envoyer à l'agent" is disabled

Either a required answer is missing (the count is shown next to the button), or the agent changed the questions and
"Afficher les nouvelles questions" must be clicked first.

### "Brouillon non enregistré"

The draft save failed (server unreachable, or the session was closed). Your input is still in the form, and sending is
still possible if the server is back.

### "Réponses invalides" (422) on sending

The server validates against the current questions. The list under the buttons says what is wrong (missing required
answer, unknown option, several options on a single-choice question). If the agent just edited the questions, show the new
version first.

## Connection and security errors

### 403 `Host non autorisé` or `Origin non autorisée`

Cause: the server only accepts requests whose `Host` header is `127.0.0.1:<port>`, `localhost:<port>`, the host of
`AQ_PUBLIC_URL`, or a name from `AQ_ALLOWED_HOSTS`; and, when an `Origin` header is present, only known origins. This
blocks DNS rebinding and cross-origin calls.

Fix:

- Reaching the server by another name or IP (a LAN address, a Docker service name): add the host name to
  `AQ_ALLOWED_HOSTS` (comma separated; the port is added for you).
- Behind a reverse proxy: set `AQ_PUBLIC_URL` to the public HTTPS address and make the proxy forward the original `Host`.
- Docker with another published port: pass the same port to the server, for example
  `-e AQ_PORT=4318 -p 127.0.0.1:4318:4318`. A mismatch gives `Host non autorisé`.
- A browser-based MCP client (llama-server, for example): add its page origin to `AQ_ALLOWED_ORIGINS`, exact and without
  `*` (for example `http://localhost:8080`).
- Developing the UI with `ng serve`: start the server with `AQ_DEV=1` to allow `localhost:4200`.

### 401 on `/mcp` (`server` profile)

Causes: no `Authorization: Bearer aq_...` header, a revoked or expired token (tokens last one year), a disabled account (its tokens may also have been deleted when it was disabled),
or a session cookie used instead of a token (cookies do not open `/mcp`).

Fix: create a new token in "Mon compte" and register it again with your client
([Connect your agent](connect-your-agent.md#shared-server-api-token)).

### 401 in the UI, redirected to `/login`

Your sign-in session ended (7 days maximum, 1 day idle, or your password was changed on another device, or the account
was disabled). Sign in again.

### The token works for `/mcp` but not for the UI

By design: a token opens only `/mcp`. Use your account to sign in to the UI.

### 403 `Droits insuffisants`

The page needs the `admin` role ("Utilisateurs", "Sessions").

### 429 on sign-in

10 failed attempts in 15 minutes (per username or per address). Wait; the counter also resets on server restart. Behind a
reverse proxy, make sure `AQ_TRUST_PROXY` is set, otherwise all users share the proxy's address and one person can lock out
the others.

### Invitation link "invalide ou expirée"

The link is single-use, valid for 7 days, replaced by any newer link, and unusable if the account is disabled. Ask an
admin for "Nouveau lien".

### 404 JSON under `/mcp/*`, `/api`, `/auth` or `/.well-known`

Expected for unknown routes: the server answers 404 JSON rather than the UI page, so a client probing OAuth discovery under
`/.well-known` fails cleanly. Agent Questions does not use OAuth: register the plain `/mcp` URL.

## Docker and network

### The port is not reachable from another machine

The port is published on `127.0.0.1` of the machine that runs Docker, so a client on another machine (Windows to a Linux
VM, for example) cannot see it. Use an SSH tunnel, for example `ssh -L 4317:127.0.0.1:4317 user@vm`, and keep the
default `127.0.0.1` URL on the client. For a shared deployment use the `server` profile behind HTTPS instead
([Operations](../operations/index.md)).

### The container does not start (permissions)

A `/data` mount that belongs to root (a volume created by an older image version, or a host directory such as
`~/.agent-questions` created by another user) is not writable by the container user (uid 1000). Make it writable once:

```bash
docker run --rm -v ~/.agent-questions:/data alpine chown -R 1000:1000 /data
```

### The server refuses to start

The error names the variable to fix. Common ones:

| Message about                  | Meaning                                                                                  |
| ------------------------------ | ---------------------------------------------------------------------------------------- |
| `AQ_BIND_HOST` in `local`      | Only `127.0.0.1`, `::1`, `localhost` allowed (or `0.0.0.0` inside a container with `AQ_IN_CONTAINER=1`). |
| `AQ_PUBLIC_URL`                | Required in `server` profile, and must be HTTPS (except loopback).                       |
| `AQ_DATA_DIR`                  | Required in `server` profile.                                                            |
| `AQ_ALLOWED_ORIGINS`           | No `*`; each entry must be an origin without a path.                                     |
| `AQ_ADMIN_PASSWORD`            | 10 to 200 characters.                                                                    |
| `AQ_WAIT_SECONDS`              | Integer from 0 to 3600.                                                                  |

Full list: [Configuration](../reference/configuration.md).

### The server is not running when the agent calls

The MCP client reports a connection error. Start the server (Docker with `--restart unless-stopped` brings it back after
a reboot). Pending questions survive restarts: they are in the database.

### The stdio launcher fails or the server does not start

The launcher prints the last lines of `<data dir>/server.log` (`~/.agent-questions/server.log` by default) on stderr.

- **Port already in use**: another program (or a server with a different configuration) holds the port. Change
  `AQ_PORT` for both the client entry and the server, or stop the other program. The launcher only trusts a `200` from
  `/health` with `status: ok`; any other service on the port makes the MCP `initialize` fail.
- **The server fails at startup**: read `server.log` (invalid `AQ_*` variable, locked database...).
- **Stale lock**: `launcher.lock` in the data directory is ignored after 30 seconds; delete it if a launcher crashed.
- **Slow first start**: migrations run on the first launch; the launcher waits up to 15 seconds.
- **Detached server to stop**: the launcher never stops it; end the process listening on the port.

### Health check

`GET /health` returns 200, or 503 if the database does not answer or the server is shutting down.
