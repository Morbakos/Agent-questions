# Rules and limits

The rules below are what the code enforces today. Each has an id (`RG-...`) so tickets and tests can refer to it. Sizes
come from `packages/shared/src/schema.ts` and `packages/shared/src/limits.ts`; the rest from the server services.

## Sessions and questions

| Id      | Rule                                                                                                              |
| ------- | ----------------------------------------------------------------------------------------------------------------- |
| RG-S-01 | A session belongs to one user, who alone can read it, answer it or decline it.                                    |
| RG-S-02 | Someone else's session is "not found" (404), never "forbidden". The one exception is an admin's read-only view.   |
| RG-S-03 | A session is `pending`, `answered` or `declined`. The last two are final.                                         |
| RG-S-04 | A user has at most **100 pending sessions**. Beyond that `ask_user` fails with a conflict (409) until some are answered or declined. |
| RG-S-05 | A question list has 1 to 30 questions, with unique ids.                                                           |
| RG-S-06 | A `single` or `multi` question has 2 to 20 options with unique ids. A `text` question needs none.                 |
| RG-S-07 | A question id is snake_case: `^[a-z0-9_]{1,64}$`.                                                                 |
| RG-S-08 | A title is at most 120 characters. Default: "Questions de l'agent".                                              |

## Resuming without duplicates

| Id      | Rule                                                                                                                                         |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| RG-R-01 | `ask_user` fingerprints the **title and questions**. It returns the user's existing session with the same fingerprint if that session is pending, or closed but not yet delivered. |
| RG-R-02 | Lookup and creation are atomic: two identical simultaneous calls create one session.                                                         |
| RG-R-03 | With a `session_id`, `ask_user` resumes that session without comparing questions. An unknown `session_id` is an error (404).                 |
| RG-R-04 | Changing the title or any content of a question changes the fingerprint: a new session is created.                                           |
| RG-R-05 | A session is "delivered" when `ask_user`, `get_answers` or `update_questions` returns its answers or its refusal to the agent. Asking the same questions afterwards creates a new session. |

## Answers and drafts

| Id      | Rule                                                                                                                                        |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| RG-A-01 | A question is **required** by default. An optional question may stay unanswered.                                                            |
| RG-A-02 | A `text` question is answered when its text is not blank.                                                                                   |
| RG-A-03 | A choice question is answered when an option is picked, or when "Autre" is allowed and its text is not blank.                               |
| RG-A-04 | The server refuses (422, with the list of problems) a missing required answer, an unknown option, several options for a `single` question, an answer to an unknown question, a note on an option that is not picked, and notes on a question with `allow_notes: false`. |
| RG-A-05 | "Autre" is offered by default on choice questions. With `allow_other: false` its text no longer counts toward "answered".                   |
| RG-A-06 | The UI saves the draft 600 ms after the last keystroke. Only a pending session accepts a draft.                                             |
| RG-A-07 | Answer text: at most 50,000 characters. Note: 5,000. Refusal reason: 2,000.                                                                 |
| RG-A-08 | A decline needs no reason (default: empty). The agent then receives a default reason, "L'utilisateur a choisi de ne pas répondre.".         |

## Edits by the agent

| Id      | Rule                                                                                                                              |
| ------- | --------------------------------------------------------------------------------------------------------------------------------- |
| RG-M-01 | `update_questions` only works on a pending session; otherwise it fails with a conflict (409) and the agent must call `get_answers`. |
| RG-M-02 | The new list replaces the old one entirely. The fingerprint is recomputed and `revision` increases by 1.                          |
| RG-M-03 | The draft is kept for questions whose id remains, minus options that disappeared.                                                 |
| RG-M-04 | The UI never replaces the form without the user's consent and suspends sending until the new version is shown.                    |

## Waiting

| Id      | Rule                                                                                                                              |
| ------- | --------------------------------------------------------------------------------------------------------------------------------- |
| RG-W-01 | Waiting is chosen per call with `wait_seconds` (0 to 3600). Without it, the server default applies (`AQ_WAIT_SECONDS`, `0`).      |
| RG-W-02 | With 0, the call returns `pending` at once.                                                                                       |
| RG-W-03 | A wait ends on answer, decline, timeout, the client dropping the call, or server shutdown. The agent then gets the current state. |
| RG-W-04 | The agent is not notified of a late answer. Answers are kept and fetched with `get_answers`.                                      |
| RG-W-05 | While waiting, if the client supplied a progress token, the server sends a progress notification every 15 seconds.                |

## Accounts (`server` profile)

| Id      | Rule                                                                                                                              |
| ------- | --------------------------------------------------------------------------------------------------------------------------------- |
| RG-C-01 | On first start with no account, an administrator is created. Its password is printed once if not configured.                      |
| RG-C-02 | An account is created without a password. The person chooses one through a single-use invitation link, valid for 7 days.         |
| RG-C-03 | A new invitation link invalidates the previous one.                                                                               |
| RG-C-04 | At least one active administrator always remains (409 otherwise).                                                                 |
| RG-C-05 | Disabling an account closes its sign-in sessions and live streams, deletes its invitations, and its API tokens stop working (and are deleted if the administrator chose so). |
| RG-C-06 | Accepting an invitation or changing a password closes the person's other sign-in sessions.                                        |
| RG-C-07 | A password has 10 to 200 characters. A username has 3 to 40 characters (letters, digits, `.`, `-`, `_`; starts with a letter or digit). |
| RG-C-08 | 10 failed sign-ins in 15 minutes, per username or per address, block sign-in (429). The counter is in memory: a restart resets it. |
| RG-C-09 | A sign-in session lasts at most 7 days and 1 day without activity.                                                                |
| RG-C-10 | An API token is shown once, expires after one year, has a name of 1 to 60 characters, and a user has at most 20.                  |
| RG-C-11 | An API token opens only `/mcp`.                                                                                                   |
| RG-C-12 | An admin views all sessions read-only. Each read is logged.                                                                       |

## Browser

| Id      | Rule                                                                                                                                         |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| RG-N-01 | The server opens the browser only if the user has no connected UI (or one opened less than 15 seconds ago), the session is pending, and `AQ_NO_OPEN` is not `1`. |
| RG-N-02 | The `server` profile never opens a browser.                                                                                                  |
| RG-N-03 | New questions are announced only to the owner's tabs. An announcement is replayed to a tab that connects within 10 seconds.                 |

## Size bounds

Any request body is limited to 10 MiB (`413` above). The largest `ask_user` the field bounds below allow is about 8 MB,
so it fits.

### Session and questions

| Field                                  | Bound                              |
| -------------------------------------- | ---------------------------------- |
| `title`                                | at most 120 characters             |
| `questions`                            | 1 to 30                            |
| question `id`                          | `^[a-z0-9_]{1,64}$`                |
| question `header`                      | at most 60 characters              |
| question `prompt`                      | 1 to 20,000 characters             |
| question `context_markdown`            | at most 200,000 characters         |
| question `placeholder`                 | at most 200 characters             |
| question `options`                     | 2 to 20 for `single` / `multi`     |
| option `id`                            | 1 to 64 characters                 |
| option `label`                         | 1 to 200 characters                |
| option `description`                   | at most 2,000 characters           |
| `wait_seconds`                         | integer, 0 to 3600                 |
| `session_id`                           | a UUID                             |

### Answers

| Field                           | Bound                            |
| ------------------------------- | -------------------------------- |
| `selected` per question         | at most 50 ids                   |
| `text` per question             | at most 50,000 characters        |
| note per selected option        | at most 5,000 characters         |
| decline `reason`                | at most 2,000 characters         |

### Accounts

| Field                      | Bound                              |
| -------------------------- | ---------------------------------- |
| password                   | 10 to 200 characters               |
| username                   | 3 to 40 characters                 |
| API token name             | 1 to 60 characters                 |
| API tokens per user        | 20                                 |
| invitation link validity   | 7 days                             |
| API token validity         | 1 year                             |
| sign-in session            | 7 days absolute, 1 day idle        |

### Lists and polling

| Item                                  | Value                          |
| ------------------------------------- | ------------------------------ |
| History page size (user and admin)    | 50                             |
| List and open session polling         | every 5 seconds                |
| Draft save delay                      | 600 ms                         |
| Live stream keep-alive                | every 15 seconds               |

## Known limits

- **No automatic cleanup**: old sessions stay in the database until you remove them yourself (about 3 KB per session).
- **No push to the agent**: after a timeout the agent does not know you answered. Tell it to call `get_answers`.
- **Client timeouts**: some MCP clients cut long tool calls before the `wait_seconds` the agent asked for. Raise the
  client's tool timeout (Codex: `tool_timeout_sec`, 60 s by default; Claude Code: 5-minute idle window for HTTP servers)
  or keep `wait_seconds` short and let the agent poll with `get_answers`. Details:
  [Connect your agent](../guide/connect-your-agent.md#tool-call-timeouts).
- **One server process**: the waiting mechanism is in memory, so the database must have a single writer process.
- **Local profile has no login**: do not expose it to a network.
- **No password reset flow**: an admin issues a new invitation link.
- **Roles are coarse**: only `admin` and `member`.
