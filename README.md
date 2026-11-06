# Agent Questions

An MCP server with a web UI that lets an AI agent ask you **long or complex questions**: markdown context, code, many
options, free-text fields. It replaces the built-in question tools of agents (such as `AskUserQuestion` in Claude Code),
which become hard to read once a question needs more than a few lines.

The agent calls the `ask_user` tool. You answer in a form in your browser. Your answers come back to the agent.

```text
 Agent (Claude Code, Codex, Cursor, ...)
   |  MCP, Streamable HTTP: POST /mcp
   v
+------------------------------ one process ------------------------------+
|  ask_user / get_answers / update_questions     SQLite (sessions, drafts) |
|  Angular UI + HTTP API  <------ you answer in the browser                |
+--------------------------------------------------------------------------+
```

## Quick start

Start the server once, then register it with your agent. One server is shared by all your agents and projects.

```bash
# 1. The server: UI and MCP on http://127.0.0.1:4317, restarted with Docker
docker run -d --name agent-questions --restart unless-stopped \
  -p 127.0.0.1:4317:4317 -v ~/.agent-questions:/data ghcr.io/morbakos/agent-questions:latest

# 2. Claude Code, for all your projects
claude mcp add --scope user --transport http agent-questions http://127.0.0.1:4317/mcp
```

Always publish the port on `127.0.0.1` (as above): the default profile has no authentication. In Docker the browser
does not open by itself, so the agent gives you the form address.

From source (requires [Bun](https://bun.sh) 1.4 or later):

```bash
bun install
bun run build
bun run start    # http://127.0.0.1:4317
```

Without Docker, a client that launches MCP servers over stdio can start Agent Questions itself. It attaches to the
shared server when one runs, and otherwise starts one in the background (it keeps running after the agent exits):

```bash
claude mcp add --scope user agent-questions -- npx -y @morbakos/agent-questions --stdio
```

The package is distributed through GitHub Packages: `npx` needs an `.npmrc` entry for the `@morbakos` scope with a
token. See [Connect your agent](docs/guide/connect-your-agent.md#option-b-stdio-launcher-no-docker).

Other agents (Codex, Cursor, VS Code...) only need the MCP HTTP URL `http://127.0.0.1:4317/mcp`: see
[Connect your agent](docs/guide/connect-your-agent.md).

## Example

The agent calls `ask_user`:

```json
{
	"title": "Storage choice",
	"questions": [
		{
			"id": "db",
			"prompt": "Which database should the **export job** use?",
			"type": "single",
			"options": [
				{ "id": "sqlite", "label": "SQLite", "recommended": true },
				{ "id": "pg", "label": "PostgreSQL" }
			]
		}
	]
}
```

By default the call does not wait: it returns `pending` with a `session_id` and the form URL, and the agent keeps
working. Once you have answered, the agent calls `get_answers` and receives:

```json
{
	"status": "answered",
	"session_id": "...",
	"answers": [{ "question_id": "db", "selected": [{ "id": "pg", "label": "PostgreSQL" }] }]
}
```

The agent can also pass `wait_seconds` (up to 3600) to keep the call open until you answer.

## Features

- Three MCP tools: `ask_user`, `get_answers`, `update_questions`.
- Single-choice, multiple-choice and free-text questions, with markdown, code context, recommended options, an "Other"
  field and a note per selected option.
- Drafts saved as you type; answers are stored even if the agent's call has timed out.
- Idempotent resume: asking the same title and questions again finds the existing session.
- History of past sessions, read-only.
- One tab: the UI follows the agent without taking over a form you are filling in.
- Two deployment profiles: `local` (no account) and `server` (accounts, invitations, API tokens, admin supervision).
- Single process, SQLite storage, no native dependency. Runs on Node or Bun, and as a Docker image.

## Documentation

| Audience                    | Start here                                                             |
| --------------------------- | ---------------------------------------------------------------------- |
| Using it, connecting agents | [User guide](docs/guide/index.md)                                      |
| Running it                  | [Operations](docs/operations/index.md): profiles, Docker, reverse proxy |
| Looking something up        | [Reference](docs/reference/mcp-tools.md): MCP tools, HTTP API, configuration, data model |
| Contributing                | [Development](docs/development/index.md) and [CONTRIBUTING.md](CONTRIBUTING.md) |

Also: [Troubleshooting](docs/guide/troubleshooting.md), [Security](docs/operations/security.md),
[SECURITY.md](SECURITY.md), [CHANGELOG.md](CHANGELOG.md).

## Requirements

- Server: Node 22.13 or later, or Bun 1.4 or later (SQLite comes from `node:sqlite`), or Docker.
- Building from source: Bun 1.4 or later.
- An MCP client that supports the Streamable HTTP transport, or one that launches stdio servers (`command` + `args`).

## Status and versioning

Version 0.1.x: early, the API and tool descriptions may still change. The server is distributed as the Docker image
`ghcr.io/morbakos/agent-questions`, or built from source. The npm package `@morbakos/agent-questions` is not published
for now. See the [CHANGELOG](CHANGELOG.md) and [build and release](docs/development/build-and-release.md).

## License

[MIT](LICENSE)
