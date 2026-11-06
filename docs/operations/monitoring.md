# Monitoring

## Health endpoint

```bash
curl -i http://127.0.0.1:4317/health
```

`GET /health` is public (no authentication), is never journalised, and is built on `@nestjs/terminus`:

| Status | Meaning                                                                      |
| ------ | ---------------------------------------------------------------------------- |
| `200`  | The server is up and the database answers a ping. Body: `{"status":"ok",...}` |
| `503`  | The database does not answer, or the server is shutting down                 |

Use it for container health checks (the Docker image already does, see [Docker](docker.md)), load-balancer probes and
uptime monitors. It checks the process and the database, not the reachability of the public URL: probe the public
HTTPS URL as well to cover the proxy and certificate. When called from outside, the `Host` header must be an accepted
one (see [reverse proxy](reverse-proxy.md)), otherwise the answer is `403`.

## Logs

There is a single log, written to standard output by the NestJS logger (the Fastify logger is disabled). In Docker, read
it with `docker compose logs -f agent-questions`. The level is set with `AQ_LOG`:

| `AQ_LOG`        | Shows                                           |
| --------------- | ----------------------------------------------- |
| `fatal`         | fatal errors                                    |
| `error`         | errors and above                                |
| `warn`          | warnings and above                              |
| `info` (default) | normal events and above                        |
| `debug`         | adds one line per HTTP request                  |
| `trace`         | everything `debug` shows plus verbose messages  |
| `silent`        | nothing                                         |

`silent` does not hide invalid-configuration errors: they are printed on standard error before the process exits with
code 1.

### What is logged

Each line carries a logger name:

| Logger        | Level | Content                                                                                       |
| ------------- | ----- | --------------------------------------------------------------------------------------------- |
| `auth`        | warn  | `401` / `403` responses: status, method and path, never a secret                              |
| `auth`        | log   | First administrator created; sessions adopted from the `local` profile                        |
| `auth`        | warn  | The generated first-administrator password (once, when `AQ_ADMIN_PASSWORD` is unset)          |
| `http`        | debug | `METHOD /path status duration` for each request except `/health`. Invitation tokens are masked |
| `mcp`         | log   | An agent starts waiting on a session (with its delay), a wait ends, questions were updated    |
| `supervision` | log   | An administrator lists or opens other users' sessions                                         |

Successful `/mcp` calls do not appear in the `http` lines (the MCP transport answers outside Fastify's response hook);
the `mcp` logger covers the waits instead.

Signals worth alerting on: repeated `401` / `403` lines from one address (guessing attempts; the sign-in throttle
answers `429` after 10 failures in 15 minutes), `503` on `/health`, a restart loop, and a startup `Configuration
invalide` message.

## Database size

The database is small: each session stores its questions, a draft and the answers as text, typically a few kilobytes.
The WAL file is bounded by the server (it is checkpointed every 100 pages and truncated), so a large `-wal` file is
abnormal; see [backup and upgrade](backup-and-upgrade.md#what-to-back-up).

**Nothing deletes old sessions.** Answered and declined sessions stay in the history forever, and no API or
setting removes them. Growth is linear with usage. If it matters, purge by hand with the server stopped and after a
backup, for example closed sessions older than 180 days (timestamps are milliseconds since the epoch):

```bash
docker compose stop agent-questions
# run on a copy of, or a bind mount to, the data directory, with the sqlite3 CLI
sqlite3 agent-questions.sqlite \
  "DELETE FROM sessions WHERE status != 'pending' AND answered_at < (strftime('%s','now','-180 days') * 1000);"
sqlite3 agent-questions.sqlite "VACUUM;"
docker compose start agent-questions
```

Deleting a session also makes its `session_id` unknown to agents that still hold it.
