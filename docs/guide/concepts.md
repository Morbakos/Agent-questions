# Concepts

## The flow

```
Agent --MCP (POST /mcp)--> ask_user --> SQLite (sessions, drafts, answers)
                                |                  ^
                                v                  |
                    browser: http://127.0.0.1:4317/s/<session_id>
```

1. The agent calls `ask_user` with a title and a list of questions.
2. The server stores them as a **session** and tells your browser (or opens it).
3. You fill in the form. Your input is saved as a **draft** while you type.
4. You send the answers (or decline). The server stores them.
5. The agent gets the answers, either in the `ask_user` call that was waiting, or later through `get_answers`.

The server is one HTTP process that holds the UI, the API, the database and `/mcp`. Several agents can use the same
server and share the same UI.

## Session

A session is one set of questions, with its title, your draft and your answers. It has an id (a UUID, also in the page
URL `/s/<session_id>`) and one of three statuses:

| Status     | Meaning                                                  |
| ---------- | -------------------------------------------------------- |
| `pending`  | Waiting for you. The form is editable.                   |
| `answered` | You sent your answers. Final.                            |
| `declined` | You chose not to answer, with an optional reason. Final. |

A session belongs to one user. In the `server` profile nobody else can read or answer it (an admin can only view it, see
[Accounts and roles](accounts-and-roles.md)). Past sessions are kept and listed under "Historique" (history).

## Questions

Each question has a `type`:

| Type     | What the user sees                  | `options` |
| -------- | ----------------------------------- | --------- |
| `single` | Radio buttons: exactly one option   | 2 to 20   |
| `multi`  | Checkboxes: any number of options   | 2 to 20   |
| `text`   | A free-text area                    | none      |

A question has an `id` (snake_case, unique in the session), an optional short `header` (the label in the outline),
a `prompt` and an optional `context_markdown` (shown in an expanded "Contexte" block). Both are markdown. It can also
carry a `placeholder` (for `text`).

An option has an `id`, a `label`, an optional `description`, and an optional `recommended` flag. A recommended option
shows a "Recommandé" badge. It is not preselected.

Three switches, all optional:

- `required` (default `true`): a required question must be answered before you can send. An optional one shows
  "(facultatif)".
- `allow_other` (default `true`): choice questions get a free-text "Autre" field. `false` removes it.
- `allow_notes` (default `true`): each option you pick can carry an optional note ("+ Ajouter une précision").
  `false` removes it.

A question counts as answered when:

- `text`: the text is not blank;
- `single` / `multi`: at least one option is picked, or "Autre" is allowed and its text is not blank.

In a `single` question, picking an option clears "Autre", and typing in "Autre" clears the picked option. In `multi`
they can be combined.

## Answers

What the agent receives for an answered session:

```json
{
	"status": "answered",
	"session_id": "6f1c0a52-3b7e-4c79-9a52-0d6b2f1e8a10",
	"answers": [
		{
			"question_id": "database",
			"header": "Database",
			"selected": [{ "id": "pg", "label": "PostgreSQL", "note": "We already run it" }],
			"text": "Maybe SQLite for the tests"
		}
	]
}
```

- `selected` lists the picked options with their label. `note` is absent when empty.
- `text` is the free text: the answer of a `text` question, or the "Autre" field. It is absent when empty.
- A declined session returns `{ "status": "declined", "session_id": "...", "reason": "..." }`.
- A session still waiting returns `{ "status": "pending", "session_id": "...", "url": "...", "message": "..." }`.

Full schemas: [MCP tools](../reference/mcp-tools.md).

## Draft

Every change you make in the form is saved to the server about 600 ms after you stop typing. You can close the tab and
come back: the form is restored. The footer shows "Brouillon enregistré à HH:mm" ("Draft saved at"), or
"Brouillon non enregistré" ("Draft not saved") if saving failed.

## Revision and edits by the agent

The agent can replace the questions of a pending session with `update_questions` (the complete new list, not a diff).
Each replacement increments the session's `revision`. Your draft is kept for questions whose `id` is unchanged, minus
options that no longer exist. The open form notices within 5 seconds and offers the new version instead of swapping it
under your fingers: see [Using the UI](using-the-ui.md#when-the-agent-edits-the-questions).

A session that is already answered or declined cannot be edited.

## Resuming without duplicates

The server fingerprints (SHA-256) the **title and the questions**. If the agent calls `ask_user` again with exactly the
same title and questions, it gets the existing session instead of a new one. This applies while the session is pending,
or closed but not yet delivered to the agent. Once the agent has received the answers, the same questions create a new
session.

Change the title or reword one question and you get a new, empty session. To keep working on the same one, pass
`session_id`, or use `update_questions`.

## Waiting

By default `ask_user` does not block: it returns `pending` at once with the `session_id` and the form URL. The agent
keeps working, then calls `get_answers` when it needs the answers. The agent may instead pass `wait_seconds` (0 to 3600)
to keep the call open until you answer. Your answers are never lost if the call ends first, but the agent is not
notified of a late answer: tell it to call `get_answers`. See [Troubleshooting](troubleshooting.md).

## Vocabulary

| Term      | Meaning                                                                                                      |
| --------- | ------------------------------------------------------------------------------------------------------------ |
| Session   | One set of questions and its state                                                                           |
| Draft     | Your unsent form state, saved automatically                                                                  |
| Revision  | Counter incremented each time the agent replaces the questions                                               |
| Delivered | The agent has received the answers or the refusal                                                            |
| Profile   | `local` (one user, no login) or `server` (accounts, shared), see [Accounts and roles](accounts-and-roles.md) |
| Owner     | The user a session belongs to                                                                                |
| API token | Personal `aq_...` secret that lets an MCP client act as you, `server` profile only                           |
