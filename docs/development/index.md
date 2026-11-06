# Development guide

This section is for people who work on Agent Questions itself. If you only want to use or deploy it, start with the [user guide](../guide/index.md) or the [operations guide](../operations/index.md).

Agent Questions is an MCP server plus a web UI, shipped as a single process. An agent calls the `ask_user` tool, the user answers in a form in the browser, and the answers come back as the result of the tool call.

## Prerequisites

| Tool    | Version | Why                                                                              |
| ------- | ------- | -------------------------------------------------------------------------------- |
| Bun     | >= 1.4  | The only package manager (`bun install`), bundler for the server, Docker runtime |
| Node.js | >= 22.13 | Runs Vitest and the Angular CLI; also a supported server runtime                 |
| Chromium | any    | Only for the Playwright end-to-end tests (`bunx playwright install chromium`)    |

Both Node 22.13+ and Bun 1.4+ provide `node:sqlite`, which the server relies on. CI uses Bun 1.4.4 and Node 24.

## From clone to running

```bash
git clone https://github.com/Morbakos/agent-questions.git
cd agent-questions
bun install
bun run build   # builds the UI, then bundles the server into dist/
bun run start   # http://127.0.0.1:4317, UI included
```

Check that the server answers:

```bash
curl -s http://127.0.0.1:4317/health
curl -s -X POST http://127.0.0.1:4317/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Without any `AQ_*` variable the server runs in the `local` profile: no accounts, listening on `127.0.0.1`, data in `~/.agent-questions`. See [configuration](../reference/configuration.md) for every variable.

## The dev loop

Run the two dev servers in separate terminals:

```bash
bun run dev:server   # nest start --watch --exec bun, AQ_DEV=1, API on :4317
bun run dev:ui       # ng serve on :4200, proxies /api to :4317
```

Open `http://localhost:4200`. `AQ_DEV=1` makes the server accept the `localhost:4200` origin (CORS, CSRF and the Host/Origin guard).

Things to know:

- The Angular proxy (`packages/ui/proxy.conf.json`) forwards `/api` and `/auth` to the server on `:4317`. For the `server` profile, start the server with `AQ_DEV=1` (see `dev:server`) so the `http://localhost:4200` origin is accepted, then sign in through `:4200`. The Playwright suite and a built bundle (`bun run build`, then `bun run start`) remain the reference for the `server` profile.
- You can also skip `dev:ui`: once `ng build` has produced `packages/ui/dist/ui/browser`, the dev server serves that build itself.
- The server only needs a restart to pick up configuration changes. Tool descriptions are computed once per process (see [Waiting for answers](waiting-for-answers.md)).

To exercise the full flow without a browser, create a session with an `ask_user` call, then answer it over HTTP (local profile):

```bash
curl -s -X POST http://127.0.0.1:4317/api/sessions/<session_id>/answers \
  -H 'Content-Type: application/json' \
  -d '{"<question_id>":{"selected":["<option_id>"],"text":""}}'
```

## Repository map

```text
packages/
  shared/    Types and logic shared by server and UI (TypeScript, no build step)
  server/    NestJS 12 on Fastify, MCP, MikroORM on SQLite (private package)
  ui/        Angular 21 single-page app (private package)
e2e/         Playwright tests against the built server (+ MCP Inspector CLI)
scripts/     build-server.ts, check-deps.ts, verify-package.ts, verify-built.ts
docs/        This documentation
Dockerfile, docker-compose.yml
.github/workflows/   ci.yml, publish-image.yml
package.json         Root package @morbakos/agent-questions: the published one
```

The root `package.json` is the published package. `packages/server`, `packages/ui` and `packages/shared` are private workspaces.

## Where to read next

| Page                                          | Read it to                                                                    |
| --------------------------------------------- | ----------------------------------------------------------------------------- |
| [Architecture](architecture.md)               | Understand the single-process design and the flows                            |
| [Server](server.md)                           | Find your way around the NestJS code, layering and persistence                |
| [UI](ui.md)                                   | Work on the Angular app                                                       |
| [Shared package](shared.md)                   | Change a type or schema used on both sides                                    |
| [Authentication](authentication.md)           | Touch accounts, cookies, API tokens or roles                                  |
| [Waiting for answers](waiting-for-answers.md) | Change tool behaviour or descriptions                                         |
| [Testing](testing.md)                         | Run and write tests                                                           |
| [Build and release](build-and-release.md)     | Build, package, publish, understand CI                                        |
| [Conventions](conventions.md)                 | Code style and recipes (new MCP tool, migration, controller)                  |

Reference material lives in [reference/](../reference/mcp-tools.md): [MCP tools](../reference/mcp-tools.md), [HTTP API](../reference/http-api.md), [configuration](../reference/configuration.md) and the [data model](../reference/data-model.md). The human contribution workflow (issues, pull requests) is in `CONTRIBUTING.md` at the repository root.
