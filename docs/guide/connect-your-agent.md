# Connect your agent

Agent Questions is an MCP server over **Streamable HTTP**. Any MCP client that can talk to an HTTP URL can use it. You
need two things: a running server, and the client configured with its `/mcp` URL.

## 1. Run the server

Docker is the simplest way (the container restarts with Docker):

```bash
docker run -d --name agent-questions --restart unless-stopped \
  -p 127.0.0.1:4317:4317 -v ~/.agent-questions:/data ghcr.io/morbakos/agent-questions:latest
```

Always publish the port on `127.0.0.1` (`-p 127.0.0.1:4317:4317`). Without the host address Docker exposes the server
on every interface of the machine, and the `local` profile has no login.

The server is then at `http://127.0.0.1:4317` (UI) and `http://127.0.0.1:4317/mcp` (MCP). Other ways to run it (from a
clone, shared `server` profile): [Operations](../operations/index.md).

In Docker the browser cannot be opened for you. The agent is told to give you the address of the list before it asks, and
the UI lists pending questions by itself. See [Troubleshooting](troubleshooting.md#the-browser-does-not-open).

## 2. Register the server with your client

There are two ways to declare Agent Questions: over HTTP (the server is already running, e.g. in Docker), or through
the stdio launcher below. Both end up on the same single shared server.

### Option B: stdio launcher (no Docker)

`agent-questions --stdio` is a small bridge that a client starts like any stdio MCP server:

1. it probes `GET /health` on `http://127.0.0.1:<AQ_PORT or 4317>`;
2. if nothing answers, it starts the server as a detached background process (log: `<data dir>/server.log`) and waits
   up to 15 seconds for it;
3. it relays the MCP messages between stdio and `/mcp`.

The server it starts is the shared one: it keeps running when the agent exits and the launcher never stops it. Several
agents started together get a single server (a lock file in the data directory serialises the start).

```bash
claude mcp add --scope user agent-questions -- npx -y @morbakos/agent-questions --stdio
```

For clients with a JSON file: `"command": "npx"`, `"args": ["-y", "@morbakos/agent-questions", "--stdio"]`.

- `AQ_MCP_URL`: full URL of a remote `/mcp` endpoint. The launcher then never starts a server.
- `AQ_TOKEN`: API token sent as `Authorization: Bearer ...` (server profile).
- `AQ_PORT`, `AQ_DATA_DIR`, `AQ_NO_OPEN`...: passed to the server it starts.

The package is distributed through GitHub Packages: `npx` needs an `.npmrc` with the `@morbakos` registry and a token.
A Docker server older than the `npx` package may expose different tools; the bridge does not reconcile them.

### Option A: HTTP

### Claude Code

```bash
claude mcp add --scope user --transport http agent-questions http://127.0.0.1:4317/mcp
```

`--scope user` makes it available in all your projects. Without it, the server is registered for the current project
only. Check with `claude mcp list` (the server must show as connected) or `/mcp` inside a session.

Equivalent `.mcp.json` entry:

```json
{
	"mcpServers": {
		"agent-questions": { "type": "http", "url": "http://127.0.0.1:4317/mcp" }
	}
}
```

Scopes: `local` (default, you in the current project), `project` (shared through `.mcp.json`), `user` (you, all
projects). Official documentation: [Claude Code MCP](https://code.claude.com/docs/en/mcp).

### Codex (CLI)

Config file: `~/.codex/config.toml`, or `.codex/config.toml` in a trusted project.

```toml
[mcp_servers.agent-questions]
url = "http://127.0.0.1:4317/mcp"
```

The documented CLI form for an HTTP server is `codex mcp add <name> --url <url>`. Official documentation:
[Codex MCP](https://developers.openai.com/codex/mcp).

### Cursor

Config file: `~/.cursor/mcp.json` (all projects) or `.cursor/mcp.json` (one project).

```json
{
	"mcpServers": {
		"agent-questions": { "url": "http://127.0.0.1:4317/mcp" }
	}
}
```

Official documentation: [Cursor MCP](https://cursor.com/docs/context/mcp).

### VS Code (GitHub Copilot)

Config file: `.vscode/mcp.json` in the workspace, or the `mcp.json` of your user profile (command palette:
**MCP: Add Server**).

```json
{
	"servers": {
		"agent-questions": { "type": "http", "url": "http://127.0.0.1:4317/mcp" }
	}
}
```

Official documentation: [MCP servers in VS Code](https://code.visualstudio.com/docs/copilot/customization/mcp-servers),
[MCP configuration reference](https://code.visualstudio.com/docs/agents/reference/mcp-configuration).

### Other clients

Any client that sends JSON-RPC over HTTP `POST` and accepts `application/json` and `text/event-stream` responses works.
Declare an MCP server of type "HTTP" ("Streamable HTTP") with the URL `http://127.0.0.1:4317/mcp`; see your client's
documentation for the file and syntax.

The server is stateless: it does not use the `Mcp-Session-Id` header, so any client behaviour around MCP sessions is
irrelevant.

### Browser-based clients

A client that runs in a browser (for example the llama.cpp `llama-server` web UI) sends an `Origin` header, which the
server refuses unless you allow it:

```bash
AQ_ALLOWED_ORIGINS=http://localhost:8080,http://127.0.0.1:8080
```

Origins must be exact (`scheme://host:port`, no path, never `*`). Start `llama-server` with `--jinja`: it is required
for tool calling. Open WebUI (a version that supports MCP Streamable HTTP) can connect to
`http://agent-questions:4317/mcp` when both containers share a Docker network; add `AQ_ALLOWED_HOSTS=agent-questions` so
the `Host` check accepts that name.

## Shared server: API token

On a `server` profile deployment ([Accounts and roles](accounts-and-roles.md)), `/mcp` requires an API token. Create
one in the UI (page "Mon compte", section "Jetons personnels"), copy it once, and send it in the `Authorization`
header.

Claude Code:

```bash
claude mcp add --transport http agent-questions https://questions.example.com/mcp \
  --header "Authorization: Bearer aq_..."
```

`.mcp.json`:

```json
{
	"mcpServers": {
		"agent-questions": {
			"type": "http",
			"url": "https://questions.example.com/mcp",
			"headers": { "Authorization": "Bearer aq_..." }
		}
	}
}
```

To keep the token out of the file, Claude Code expands environment variables in `url` and `headers`
(`"Authorization": "Bearer ${AQ_TOKEN}"`). Do not commit a file that contains a token.

Codex (`config.toml`): read the token from an environment variable, or set a header.

```toml
[mcp_servers.agent-questions]
url = "https://questions.example.com/mcp"
bearer_token_env_var = "AQ_TOKEN"
# or: env_http_headers = { "Authorization" = "AQ_AUTH_HEADER" }  (variable holds "Bearer aq_...")
# or: http_headers = { "Authorization" = "Bearer aq_..." }       (static, avoid committing)
```

Cursor (`mcp.json`), with `${env:NAME}` interpolation in `url` and `headers`:

```json
{
	"mcpServers": {
		"agent-questions": {
			"url": "https://questions.example.com/mcp",
			"headers": { "Authorization": "Bearer ${env:AQ_TOKEN}" }
		}
	}
}
```

VS Code (`mcp.json`), prompting for the token once and storing it securely (`${input:...}`):

```json
{
	"inputs": [{ "type": "promptString", "id": "aq-token", "description": "Agent Questions API token", "password": true }],
	"servers": {
		"agent-questions": {
			"type": "http",
			"url": "https://questions.example.com/mcp",
			"headers": { "Authorization": "Bearer ${input:aq-token}" }
		}
	}
}
```

A token opens only `/mcp`. It does not give access to the UI or to the account. The session cookie does not work on
`/mcp`. Tokens expire after one year.

## Tool call timeouts

Relevant only if the agent passes a long `wait_seconds`.

- **Claude Code**: a call that sends no response and no progress notification for 5 minutes (HTTP servers) aborts.
  Change the window with `CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT` (milliseconds, `0` disables it). The overall limit is
  `MCP_TOOL_TIMEOUT` (about 28 hours when unset) or a per-server `"timeout"` in milliseconds in `.mcp.json`. The docs do
  not say whether SSE keepalive comments count as activity: do not rely on them. Source:
  [Claude Code MCP](https://code.claude.com/docs/en/mcp#time-limits-on-mcp-tool-calls).
- **Codex**: `tool_timeout_sec` (default 60) and `startup_timeout_sec` (default 10) in the server's table, for example
  `tool_timeout_sec = 3600`. Source: [Codex MCP](https://developers.openai.com/codex/mcp).
- **Cursor, VS Code**: no timeout setting is documented.

## 3. Tell the agent when to use it

Add this to your `CLAUDE.md` or `AGENTS.md`:

> For any decision that needs several questions or a lot of context, use the MCP tool `ask_user` instead of asking in
> the terminal, but only for open questions or choices you cannot settle alone: never to have me approve a plan or a
> change (present those in your reply). If the result is `pending`, call `get_answers` with the `session_id` and never
> re-ask the same questions. If I tell you I have answered, call `get_answers` with the `session_id` of that session.

The tool description already tells the agent the same things, and says it can run the call in the background if the client
supports it. The snippet makes the behaviour reliable.

## Checking that it works

With the server running:

```bash
curl -s -X POST http://127.0.0.1:4317/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

The result lists `ask_user`, `get_answers` and `update_questions`. On a `server` deployment add
`-H 'Authorization: Bearer aq_...'`.

## What happens on the first question

By default `ask_user` does not wait. It creates the form, returns `pending` with the form URL, and the agent carries on
and calls `get_answers` when it needs your answers. If your client cuts long calls, or you prefer the agent to block, see
the waiting rules in [Concepts](concepts.md#waiting) and the timeout tips in
[Troubleshooting](troubleshooting.md#the-call-times-out-or-the-agent-says-pending).

Tool reference: [MCP tools](../reference/mcp-tools.md).
