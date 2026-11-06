# MCP tools reference

Agent Questions exposes three MCP tools: [`ask_user`](#ask_user), [`get_answers`](#get_answers) and
[`update_questions`](#update_questions). This page lists every parameter, result and error. For the concepts behind
them (sessions, waiting, idempotent resume) see [Concepts](../guide/concepts.md); to wire a client, see
[Connect your agent](../guide/connect-your-agent.md).

## Transport and identity

| Item              | Value                                                                                                                                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Endpoint          | `POST {AQ_PUBLIC_URL}/mcp` (MCP Streamable HTTP, default `http://127.0.0.1:4317/mcp`)                                                                                                                  |
| Server name       | `agent-questions`                                                                                                                                                                                      |
| State             | Stateless: no `Mcp-Session-Id`, one MCP server and one transport per request                                                                                                                           |
| Request headers   | `Content-Type: application/json`, `Accept: application/json, text/event-stream`                                                                                                                        |
| Authentication    | Local profile: none (the local user). Server profile: `Authorization: Bearer aq_<id>_<secret>` (a personal API token, see [Accounts and roles](../guide/accounts-and-roles.md)). A session cookie is refused on `/mcp`. |
| Server `instructions` | Sent only when the browser is not opened automatically (`AQ_NO_OPEN=1`, or the server profile): it asks the agent to give the user the list address before calling `ask_user`.                     |

The owner of a session is the authenticated user of the HTTP request, never a tool argument. A session that belongs
to another user is reported as unknown.

The tool descriptions are read by models, and two of them depend on the configuration: the default of `wait_seconds`
(`AQ_WAIT_SECONDS`) and the relay hint (`AQ_NO_OPEN`). They are computed once per process, at startup. See
[Configuration](configuration.md).

## Calling a tool

Any MCP client works. With plain HTTP:

```bash
curl -s -X POST http://127.0.0.1:4317/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "ask_user",
      "arguments": {
        "title": "Database choice",
        "questions": [
          {
            "id": "db",
            "prompt": "Which database should the service use?",
            "type": "single",
            "options": [
              { "id": "pg", "label": "PostgreSQL", "recommended": true },
              { "id": "sqlite", "label": "SQLite" }
            ]
          }
        ]
      }
    }
  }'
```

Every tool returns one MCP `text` content block whose text is a JSON document (see
[Results](#results)); there is no `structuredContent`. In the server profile, add the header
`-H 'Authorization: Bearer aq_...'` to the command above.

## Shared types

### Question

Used by `ask_user.questions` and `update_questions.questions`. Source: `QuestionSchema` in
`packages/shared/src/schema.ts`.

| Field              | Type                                | Required                 | Default | Bounds and rules                                                                                              |
| ------------------ | ----------------------------------- | ------------------------ | ------- | ------------------------------------------------------------------------------------------------------------- |
| `id`               | string                              | yes                      |         | Matches `^[a-z0-9_]{1,64}$` (snake_case). Unique within the call. Keys the answers.                           |
| `prompt`           | string (markdown)                   | yes                      |         | 1 to 20,000 characters.                                                                                       |
| `type`             | `"single"`, `"multi"` or `"text"`   | yes                      |         | `single`: one option. `multi`: several options. `text`: free text.                                            |
| `header`           | string                              | no                       | none    | At most 60 characters. Short label shown in the outline; also used in "missing answer" messages.              |
| `context_markdown` | string (markdown)                   | no                       | none    | At most 200,000 characters. Code, diffs, trade-offs; shown in a collapsible block.                            |
| `options`          | array of [Option](#option)          | for `single` and `multi` | none    | At most 20. At least 2 for `single` and `multi`, with unique `id`s. Not validated for `text` and not displayed. |
| `allow_other`      | boolean                             | no                       | `true`  | Adds a free-text "Autre" ("Other") field to `single`/`multi`. `false` removes it.                             |
| `allow_notes`      | boolean                             | no                       | `true`  | Lets the user attach an optional note to each selected option (returned as `selected[].note`). `false` removes it. |
| `required`         | boolean                             | no                       | `true`  | A required question must be answered before the user can submit.                                              |
| `placeholder`      | string                              | no                       | none    | At most 200 characters.                                                                                       |

### Option

| Field         | Type    | Required | Bounds and rules                                                                                       |
| ------------- | ------- | -------- | ------------------------------------------------------------------------------------------------------ |
| `id`          | string  | yes      | 1 to 64 characters. Stable identifier, unique within the question.                                     |
| `label`       | string  | yes      | 1 to 200 characters.                                                                                   |
| `description` | string  | no       | At most 2,000 characters.                                                                              |
| `recommended` | boolean | no       | Shows a "Recommandé" ("Recommended") badge. The option is not preselected. Several options may be marked. |

### `wait_seconds`

Present on all three tools. Integer from 0 to 3600 (inclusive), optional. When omitted the value of `AQ_WAIT_SECONDS`
is used (default `0`). Values above 3600 are rejected by the input schema.

- `0`: the call does not wait; it returns the current state at once.
- A positive value: the call blocks until the user answers or declines, the delay expires, the client cancels the
  call, or the server shuts down. It then returns the state at that moment.

While a call waits, the server sends an MCP progress notification right away and then every 15 seconds, if the client
accepted progress reporting. The messages are in French (`En attente de la réponse de l'utilisateur`). A failed
notification never interrupts the call.

## Tools

### `ask_user`

Title: "Ask the user (rich form)". Annotations: `idempotentHint: true`, `destructiveHint: false`,
`openWorldHint: false`.

Creates a question session and shows it in the web UI, or resumes an existing one.

| Parameter      | Type                              | Required | Default                       | Bounds                                                       |
| -------------- | --------------------------------- | -------- | ----------------------------- | ------------------------------------------------------------ |
| `questions`    | array of [Question](#question)    | yes      |                               | 1 to 30 items; question `id`s must be unique.                |
| `title`        | string                            | no       | `Questions de l'agent`        | At most 120 characters.                                      |
| `session_id`   | string (UUID)                     | no       | none                          | Session returned by an earlier call.                         |
| `wait_seconds` | integer                           | no       | `AQ_WAIT_SECONDS` (default 0) | 0 to 3600. See [`wait_seconds`](#wait_seconds).              |

Behaviour:

1. Question ids are checked for duplicates (`Duplicate question ids`).
2. With `session_id`: the session is looked up for the current owner, whatever its status. `title` and `questions`
   are then **ignored**. An unknown id fails. Use this to keep waiting on a session instead of re-asking.
3. Without `session_id`: the server computes a SHA-256 hash of the title and the questions and looks for a
   **reusable** session of the same owner: same hash, and either still `pending` or closed but not yet delivered
   (`delivered_at` is empty). If one exists it is returned and no new form is created. Otherwise a new session is
   created, unless the owner already has 100 pending sessions.
4. When a session is created, the open UI tabs of the owner are notified. If the browser may be opened
   (`AQ_NO_OPEN` unset, local profile) and no UI tab of the owner is connected, the server opens the session
   address in the default browser.
5. The call waits as described in [`wait_seconds`](#wait_seconds), then returns a [result](#results).

Changing the title or any question produces a different hash, hence a new session. See
[Data model](data-model.md#session-lifecycle).

Example result when the user has not answered yet (the default behaviour):

```json
{
	"status": "pending",
	"session_id": "6f1d3c1e-9d3b-4a53-9c1e-0f4f5f6a7b8c",
	"url": "http://127.0.0.1:4317/s/6f1d3c1e-9d3b-4a53-9c1e-0f4f5f6a7b8c",
	"message": "The user has not answered yet. Tell the user the form is waiting at the url (they can open it if the page did not open by itself), and keep working on whatever does not depend on the answers. When you need the answers, or when the user tells you they have answered, call get_answers with this session_id (set wait_seconds to wait for them). Do not re-ask the questions."
}
```

### `get_answers`

Title: "Get the answers of a question session". Annotations: `idempotentHint: true`, `destructiveHint: false`,
`openWorldHint: false`.

Reads the state of a session created by `ask_user`, optionally waiting for the answers.

| Parameter      | Type          | Required | Default                       | Bounds                                          |
| -------------- | ------------- | -------- | ----------------------------- | ----------------------------------------------- |
| `session_id`   | string (UUID) | yes      |                               | Must belong to the caller.                      |
| `wait_seconds` | integer       | no       | `AQ_WAIT_SECONDS` (default 0) | 0 to 3600. See [`wait_seconds`](#wait_seconds). |

An unknown `session_id` (or one owned by someone else) fails with `session_id inconnu : <id>`. A pending session
also triggers the browser-opening rule described for `ask_user`.

### `update_questions`

Title: "Edit the questions of a pending session". Annotations: `idempotentHint: true`, `openWorldHint: false`
(`destructiveHint` is not set).

Replaces the questions, and optionally the title, of a session that is still pending.

| Parameter      | Type                           | Required | Default                       | Bounds                                                |
| -------------- | ------------------------------ | -------- | ----------------------------- | ----------------------------------------------------- |
| `session_id`   | string (UUID)                  | yes      |                               | Must belong to the caller.                            |
| `questions`    | array of [Question](#question) | yes      |                               | 1 to 30 items, unique `id`s. The **complete** new list, not a diff. |
| `title`        | string                         | no       | current title kept            | At most 120 characters.                               |
| `wait_seconds` | integer                        | no       | `AQ_WAIT_SECONDS` (default 0) | 0 to 3600. See [`wait_seconds`](#wait_seconds).       |

Behaviour:

- The title, the questions and the hash are replaced and `revision` is incremented by one.
- The user's draft is kept for questions whose `id` is unchanged; selected options that no longer exist are dropped
  from it. Keep the ids of questions you only reword.
- An open form notices the change within about 5 seconds, shows the new version and suspends submission until the
  user accepts it. No event is pushed.
- It then waits as described in [`wait_seconds`](#wait_seconds) and returns a [result](#results).

## Results

The text of the content block is JSON with a `status` field.

### `answered`

```json
{
	"status": "answered",
	"session_id": "6f1d3c1e-9d3b-4a53-9c1e-0f4f5f6a7b8c",
	"answers": [
		{
			"question_id": "db",
			"header": "Database",
			"selected": [{ "id": "pg", "label": "PostgreSQL", "note": "We already run it for billing." }],
			"text": "Maybe DuckDB for analytics later."
		}
	]
}
```

| Field                   | Type             | Notes                                                                                                         |
| ----------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------- |
| `answers[]`             | array            | One entry per question, in question order. A question the user left empty still appears, with `selected: []`. |
| `answers[].question_id` | string           | The question `id`.                                                                                            |
| `answers[].header`      | string           | Omitted when the question has no `header`.                                                                    |
| `answers[].selected[]`  | array of objects | `id` (option id) and `label` (current option label; falls back to the id if the option no longer exists). `note` is omitted when empty. |
| `answers[].text`        | string           | Omitted when empty. For `text` questions: the answer. For `single`/`multi`: the free text of the "Autre" field. |

Returning an `answered` result marks the session as delivered (`delivered_at`). From then on, an identical
`ask_user` call (same title and questions) creates a new session instead of returning this one.

### `declined`

```json
{
	"status": "declined",
	"session_id": "6f1d3c1e-9d3b-4a53-9c1e-0f4f5f6a7b8c",
	"reason": "Not now, the scope is not decided."
}
```

`reason` is the text typed by the user; when empty it is `L'utilisateur a choisi de ne pas répondre.` ("The user
chose not to answer."). A `declined` result also marks the session as delivered.

### `pending`

Same shape as the example under [`ask_user`](#ask_user): `status`, `session_id`, `url` (`{AQ_PUBLIC_URL}/s/<session_id>`)
and a `message` that repeats the instruction to call `get_answers`. Returned when the user has not answered before the
delay, immediately when `wait_seconds` is 0, and also when the server is shutting down.

## Errors

A failed call returns `isError: true` with a plain text message (not JSON) that the agent can read and act on. Only
messages from HTTP-style errors reach the agent; any other failure becomes a generic `Internal server error`.

| Situation                                                  | Tool(s)                                 | Message                                                                                            |
| ---------------------------------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Input does not match the schema (missing field, bound exceeded, malformed question, fewer than 2 options, duplicate option ids, invalid UUID) | all | Validation message produced by the MCP SDK; the call is refused before the tool runs.            |
| Duplicate question ids                                     | `ask_user`, `update_questions`          | `Duplicate question ids`                                                                           |
| Unknown `session_id` (or another user's)                   | all                                     | `session_id inconnu : <id>`                                                                        |
| Session already answered or declined                       | `update_questions`                      | `Session already <answered\|declined>: it cannot be edited. Call get_answers with this session_id.` |
| Session closed between the check and the update            | `update_questions`                      | `Cette session est déjà clôturée.`                                                                 |
| 100 pending sessions already                               | `ask_user`                              | `Trop de sessions en attente (100) : répondez-y ou refusez-les.` ("Too many pending sessions")      |
| Missing or invalid credentials                             | all                                     | HTTP `401` on `/mcp` before any tool runs (server profile). Not a tool result.                     |

The 100-session cap is per user and counts only `pending` sessions.

## Related

- [HTTP API](http-api.md): the routes the UI uses to answer (`POST /api/sessions/:id/answers`).
- [Configuration](configuration.md): `AQ_WAIT_SECONDS`, `AQ_NO_OPEN`, `AQ_PUBLIC_URL`.
- [Rules and limits](../guide/rules-and-limits.md)
