# Waiting for answers

This page explains how the three MCP tools wait for the user, why the default is not to wait, and why the tool descriptions are written the way they are. The parameters themselves are documented in the [MCP tools reference](../reference/mcp-tools.md).

## The tools

| Tool               | Purpose                                                              | Waits?                          |
| ------------------ | -------------------------------------------------------------------- | ------------------------------- |
| `ask_user`         | Create (or resume) a session of questions                            | Only if `wait_seconds` says so  |
| `get_answers`      | Fetch the state of a session by `session_id`                         | Only if `wait_seconds` says so  |
| `update_questions` | Replace the questions of a **pending** session, then like `ask_user` | Only if `wait_seconds` says so  |

All three end in the same `waitAndRespond` method of `QuestionTools`, and all return one of three statuses: `answered`, `declined` or `pending`.

## `wait_seconds` and `AQ_WAIT_SECONDS`

- `wait_seconds` is an optional integer from 0 to 3600 on every tool.
- When omitted, the default is `AQ_WAIT_SECONDS`, itself an integer from 0 to 3600, and **0 by default**. With 0 the call returns immediately.
- The description of `wait_seconds` states the effective default of the running server, so it changes with the environment variable.

Why the default is 0: a blocked tool call freezes the agent, and many clients impose their own tool timeout, which a long wait could hit (how each client behaves with a high `wait_seconds` is not verified). With 0 the agent keeps working on what does not depend on the answers and comes back for them.

## What happens during a wait

`SessionsService.wait(owner, id, ms, signal)`:

1. Loads the session. If it is not `pending`, `ms <= 0`, the caller already aborted or the server is shutting down, it returns the session at once.
2. Otherwise it registers on the in-memory `EventEmitter` under the session id and starts a timer. It resolves, by re-reading the session, when whichever comes first happens:
   - `submit()` or `decline()` emits the id (the user answered or refused);
   - the timer fires;
   - the MCP client aborts the call (`context.signal`);
   - the server starts shutting down (`beforeApplicationShutdown` finishes every waiter while the database is still open).

During the wait, `waitAndRespond` sends an MCP progress notification right away and every 15 seconds, so clients that asked for progress keep the connection alive. The SDK also sends an SSE `: keepalive` every 15 seconds on `/mcp`; do not add another one.

The emitter is process memory, so the design requires the API and the MCP handler to share one process (see [Architecture](architecture.md#one-process)).

## Results

`answered` returns one entry per question, in the order of the questions:

```json
{
	"status": "answered",
	"session_id": "6b6e5a0e-...",
	"answers": [
		{
			"question_id": "db",
			"header": "Database",
			"selected": [{ "id": "pg", "label": "PostgreSQL", "note": "we already run it" }],
			"text": "optional free text or the 'Autre' field"
		}
	]
}
```

`declined` carries a `reason` (a default sentence when the user gave none). Reading either result sets `delivered_at`, which ends the idempotent-resume window for that question set.

`pending` carries the form `url` (`<AQ_PUBLIC_URL>/s/<session_id>`) and a `message` that restates what the agent should do: tell the user the form is waiting, keep working, call `get_answers` when it needs the answers.

The agent is **not notified** of a late answer. Either it calls `get_answers`, or the user tells it to. This is documented for users in the [connect-your-agent guide](../guide/connect-your-agent.md).

## Tool descriptions are prompts

The descriptions of `ask_user`, `get_answers` and `update_questions`, the description of `wait_seconds`, the field descriptions of the shared schemas and the `pending` message are all read by models. Editing them changes agent behaviour, so treat a wording change as a behaviour change and test it.

Properties the current text deliberately has:

- **`ask_user` is not for approvals.** It says "NOT for asking the user to approve or validate your plan...". Agents were using it as an "OK" button. A test in `mcp.e2e-spec.ts` guards this wording.
- **Background execution is conditional.** It suggests running the call as a background task only "if your client can".
- **Default is non-blocking.** When `AQ_WAIT_SECONDS` is 0, `waitingAdvice` tells the agent to continue with independent work, call `get_answers` when it needs the answers, and set `wait_seconds` only when it cannot progress. With a positive default it says the call waits and suggests a background task.
- **Never re-ask.** "Never re-ask the same questions: reuse the session_id."
- Known risk: a model that forgets the answers, or loops on `get_answers` without `wait_seconds`. The `pending` message repeats the instruction for that reason.

### Why `question-tools.ts` is imported dynamically

Descriptions depend on the configuration and are computed when the decorators run, at import time. `QuestionsMcpModule.register(config)` therefore calls `setRuntimeConfig(config)` and only then `await import("./api/question-tools.js")`. Consequences:

- Descriptions are fixed per process: changing `AQ_WAIT_SECONDS` or `AQ_NO_OPEN` needs a restart.
- In tests, the descriptions are fixed per test file (the module is cached). Tests that need another configuration live in separate files (`mcp-descriptions.e2e-spec.ts`, `mcp-nonblocking.e2e-spec.ts`).
- Never `import` `question-tools.ts` statically from another module.

## The relay hint

When the server does not open a browser (`AQ_NO_OPEN=1`, which the Docker image sets, and always in the `server` profile), nothing shows the user that a form exists. `relayHintOf` produces an instruction asked of the agent:

> The answer form does not open by itself. Before calling this tool, tell the user to open `<baseUrl>` in a browser: pending question sets are listed there and appear within a few seconds. Then call ask_user once.

It is appended to the `ask_user` description and also sent as the MCP server `instructions`. It is empty when the browser opens by itself. The user keeps the list page open: it refreshes every 5 seconds, and the SSE stream moves the open tab to a new session.

## Opening the browser

`maybeOpen` runs on every wait. It opens the session URL (`open`, `cmd /c start`, or `xdg-open` depending on the platform) only if all of these hold: `noOpen` is false, the session is `pending`, and `UiHub.hasUi(owner)` is false. It then calls `markOpened` so that a burst of calls opens one tab, not several. A failed spawn is ignored: the URL is also returned to the agent.

## Changing this behaviour: checklist

1. Edit descriptions in `question-tools.ts` or `relay-hint.ts`.
2. Update the matching tests (`mcp.e2e-spec.ts`, `mcp-descriptions.e2e-spec.ts`, `mcp-nonblocking.e2e-spec.ts`).
3. Update the README and the [connect-your-agent guide](../guide/connect-your-agent.md) if what users must do changes.
4. Run `bun run test:server`, and the browser flow with `bun run test:e2e` (late answers and the MCP Inspector scenarios).
