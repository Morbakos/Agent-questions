# Data model reference

All state lives in one SQLite database file, `agent-questions.sqlite`, inside `AQ_DATA_DIR` (default
`~/.agent-questions`). The schema is created by `migration-001-initial.ts`; entities are in the `persistence/` folders
of `packages/server/src/app/`. To back up or move the data, see [Backup and upgrade](../operations/backup-and-upgrade.md).

## Storage conventions

- **Engine**: SQLite through `node:sqlite` (Node 22.13 or later, or Bun 1.4 or later), accessed with MikroORM 7. One
  connection, one writer process.
- **Pragmas** applied at each start: `journal_mode = WAL`, `foreign_keys = ON`, `busy_timeout = 5000`,
  `wal_autocheckpoint = 100` pages, `journal_size_limit = 262144` bytes. Before opening, the server runs
  `wal_checkpoint(TRUNCATE)` on the file to flush a WAL left by an abrupt stop. The `-wal` and `-shm` files next to the
  database are normal while the server runs.
- **Migrations** run at startup. A schema change is always a new migration; a published migration is never edited.
  There is currently one: `Migration001Initial`.
- **Timestamps**: integers, milliseconds since the Unix epoch.
- **JSON columns** (`questions`, `draft`, `answers`, `metadata`) are `TEXT` holding JSON.
- **Secrets** (login sessions, invitations, API tokens) are stored only as SHA-256 hashes.

## Tables

### `sessions`

One row per question session (a form sent by an agent).

| Column           | Type    | Null | Default     | Meaning                                                                                                     |
| ---------------- | ------- | ---- | ----------- | ----------------------------------------------------------------------------------------------------------- |
| `id`             | TEXT    | no   |             | Primary key. Random UUID. This is the `session_id` seen by agents and in UI addresses (`/s/<id>`).          |
| `hash`           | TEXT    | no   |             | SHA-256 (hex) of the title and the questions. Used to resume an identical call. Not unique.                  |
| `title`          | TEXT    | no   |             | Title shown in the UI.                                                                                      |
| `questions`      | TEXT    | no   |             | JSON array of [Question](mcp-tools.md#question).                                                            |
| `draft`          | TEXT    | no   | `'{}'`      | JSON map of question id to Answer: the user's in-progress answers.                                          |
| `answers`        | TEXT    | yes  | `NULL`      | JSON map of question id to Answer, set when the user submits.                                               |
| `status`         | TEXT    | no   | `'pending'` | `pending`, `answered` or `declined`. No `CHECK` constraint: the application enforces the values.            |
| `revision`       | INTEGER | no   | `0`         | Incremented by each `update_questions`.                                                                     |
| `decline_reason` | TEXT    | yes  | `NULL`      | Text typed by the user when declining (may be empty).                                                       |
| `created_at`     | INTEGER | no   |             | Creation time.                                                                                              |
| `answered_at`    | INTEGER | yes  | `NULL`      | Closing time, for both an answer and a decline. `NULL` while pending.                                       |
| `delivered_at`   | INTEGER | yes  | `NULL`      | When an `answered` or `declined` result was first returned to an agent through a tool call. `NULL` before.   |
| `owner_user_id`  | TEXT    | no   |             | Owner. A `users.id`, or the literal `local` in the local profile. No foreign key.                           |

Indexes:

| Index                  | Definition                                                           | Serves                                                              |
| ---------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `idx_sessions_hash`    | `(hash)`                                                             | Resuming an identical `ask_user` call                               |
| `idx_sessions_owner`   | `(owner_user_id, status, created_at)`                                | Pending list of a user, pending-session cap                         |
| `idx_sessions_created` | `(created_at)`                                                       | Admin list (all sessions, newest first)                             |
| `idx_sessions_closed`  | `(owner_user_id, answered_at) WHERE status != 'pending'` (partial)   | History of a user, by closing time                                  |

Every repository method takes the owner as first argument and filters on `owner_user_id`; a session of another user
behaves as if it did not exist. Only two read-only methods skip the filter, for admin supervision.

### `users`

| Column          | Type    | Null | Default    | Meaning                                                                                  |
| --------------- | ------- | ---- | ---------- | ---------------------------------------------------------------------------------------- |
| `id`            | TEXT    | no   |            | Primary key, random UUID.                                                                |
| `username`      | TEXT    | no   |            | `UNIQUE`, `COLLATE NOCASE`: `Alice` and `alice` are the same account.                    |
| `password_hash` | TEXT    | yes  | `NULL`     | Password hash. `NULL` until the invited person chooses a password (the `pending` state). |
| `role`          | TEXT    | no   | `'member'` | `CHECK (role IN ('admin', 'member'))`.                                                   |
| `disabled`      | INTEGER | no   | `0`        | `1` disables the account.                                                                |
| `created_at`    | INTEGER | no   |            | Creation time.                                                                           |

The table is empty in the local profile. No route deletes a user; accounts are only disabled.

### `auth_sessions`

Browser login sessions (cookie), in the format of the `SessionStore` of `@nestjs/authentication`.

| Column           | Type    | Null | Meaning                                                                               |
| ---------------- | ------- | ---- | ------------------------------------------------------------------------------------- |
| `id`             | TEXT    | no   | Primary key: SHA-256 of the cookie token (the token itself is never stored).           |
| `user_id`        | TEXT    | no   | `REFERENCES users(id) ON DELETE CASCADE`.                                             |
| `created_at`     | INTEGER | no   | Creation time.                                                                        |
| `expires_at`     | INTEGER | no   | Absolute expiry (7 days after creation).                                              |
| `last_active_at` | INTEGER | no   | Last activity (idle timeout 1 day).                                                   |
| `mfa`            | TEXT    | yes  | Multi-factor state of the package. Unused by this application.                        |
| `metadata`       | TEXT    | yes  | JSON object written by the package (for example the sign-in method).                  |

Index: `idx_auth_sessions_user (user_id)`. Expired rows are deleted whenever a new session is created.

### `invitations`

| Column       | Type    | Null | Meaning                                                              |
| ------------ | ------- | ---- | -------------------------------------------------------------------- |
| `token_hash` | TEXT    | no   | Primary key: SHA-256 (hex) of the link token.                        |
| `user_id`    | TEXT    | no   | `REFERENCES users(id) ON DELETE CASCADE`.                            |
| `expires_at` | INTEGER | no   | Expiry, 7 days after issue.                                          |

Index: `idx_invitations_user (user_id)`. At most one invitation per user: issuing a new one replaces the previous one, and
expired rows are purged at the same time. An invitation is deleted when it is accepted or when its account is disabled.

### `api_tokens`

Personal tokens for MCP clients. A token has the form `aq_<id>_<secret>`.

| Column       | Type    | Null | Meaning                                                                                      |
| ------------ | ------- | ---- | -------------------------------------------------------------------------------------------- |
| `id`         | TEXT    | no   | Primary key: the public `<id>` part of the token (16 hex characters).                        |
| `user_id`    | TEXT    | no   | `REFERENCES users(id) ON DELETE CASCADE`.                                                    |
| `name`       | TEXT    | no   | Label chosen by the user (1 to 60 characters).                                               |
| `token_hash` | TEXT    | no   | `UNIQUE`. SHA-256 (base64url) of the whole token.                                            |
| `created_at` | INTEGER | no   | Creation time.                                                                               |
| `expires_at` | INTEGER | yes  | Expiry, one year after creation. Expired tokens are refused but their rows are not deleted.   |

Index: `idx_api_tokens_user (user_id)`. At most 20 tokens per user.

## Relationships

```
users 1 ──< auth_sessions     (cascade)
users 1 ──< invitations       (cascade)
users 1 ──< api_tokens        (cascade)
users 1 ··< sessions          (by owner_user_id, no foreign key; "local" in the local profile)
```

The question `id` and option `id` values live only inside the JSON of `questions`, `draft` and `answers`; they are not
columns. `answers` and `draft` are keyed by question id, and `selected` holds option ids.

## Session lifecycle

```
             ask_user (new)
                  |
                  v
             +---------+   update_questions: revision += 1, new hash
             | pending |------------------------------+
             +---------+<-----------------------------+
              |       |
   POST /answers      POST /decline
   (validated)        (reason)
              |       |
              v       v
        +----------+ +----------+
        | answered | | declined |      answered_at is set; the session is closed
        +----------+ +----------+
              \       /
               v     v
     a tool call returns the result  ->  delivered_at is set (once)
```

- **Created** by `ask_user` with `status = pending`, `revision = 0`, empty draft, `answers = NULL`. A user may have at
  most 100 pending sessions; the 101st `ask_user` fails.
- **While pending**: the user's draft is saved by `PUT /api/sessions/:id/draft`; the agent may replace the questions
  with `update_questions`. That keeps the draft entries of surviving question ids (dropping removed options from
  `selected`, and the notes attached to them; all notes are dropped if the question no longer allows notes),
  recomputes `hash`, and adds one to `revision`.
- **Closed** by the user, only by the owner: `answered` (answers validated against the questions) or `declined`. Both set
  `answered_at`. A closed session never changes again: it cannot be edited, answered or declined a second time (`409`).
  An administrator can read it but not alter it.
- **Delivered**: when `ask_user`, `get_answers` or `update_questions` returns the `answered` or `declined` result to the
  agent, `delivered_at` is set if it was still empty. It is never changed afterwards.

### Hash and idempotent resume

`hash` is the SHA-256, in hex, of `JSON.stringify({ title, questions })`: it depends on the title, on every question field
and on their order. When `ask_user` is called without `session_id`, the server looks for the newest session of the same
owner with the same hash that is either `pending` or has `delivered_at IS NULL`. If it finds one it returns it (a
closed session whose result was never delivered is returned as `answered` or `declined`); otherwise it creates a new
one. Search and creation happen in one transaction, so two simultaneous identical calls create one session.

Consequences:

- Repeating the same call after a timeout or a restart of the agent does not create a duplicate form.
- Changing the title or any question creates a new session. To change a pending form, use `update_questions`.
- After the result has been delivered, the same questions create a new session.
- Calling `ask_user` with a `session_id` skips the hash: the session is fetched by id, whatever its status.

### Ownership across profiles

In the local profile every session belongs to the owner `local`. The first time the server starts in the `server` profile
on an empty `users` table, it creates the first administrator and reassigns all sessions owned by `local` to that
account.

## Retention and size

There is no automatic cleanup of sessions: they stay until you delete the database. The only automatic purges are expired
`auth_sessions` rows (at each sign-in) and expired or replaced `invitations` rows (when an invitation is issued). Expired
`api_tokens` stay in the table.

The database is a single file plus the WAL and shared-memory files. The WAL is checkpointed every 100 pages and capped
at 256 KiB (`journal_size_limit`).

## Related

- [MCP tools](mcp-tools.md) and [HTTP API](http-api.md): the shapes of Question, Answer and the views.
- [Backup and upgrade](../operations/backup-and-upgrade.md)
- [Server internals](../development/server.md): repositories and entities.
