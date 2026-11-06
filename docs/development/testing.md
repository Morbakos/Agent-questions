# Testing

| Suite                  | Tool                    | Command                                            | Needs a build? |
| ---------------------- | ----------------------- | -------------------------------------------------- | -------------- |
| Shared                 | Vitest                  | `bun run test` (first step), config: root `vitest.config.ts` | no             |
| Server unit            | Vitest                  | `bun run --cwd packages/server test`               | no             |
| Server e2e             | Vitest                  | `bun run --cwd packages/server test:e2e`           | no             |
| UI                     | `ng test` (Vitest + jsdom) | `bun run --cwd packages/ui test`                | no             |
| Browser e2e            | Playwright + Chromium   | `bun run test:e2e`                                 | yes (`bun run build`) |
| Packaged server        | `scripts/verify-package.ts` | `bun run verify:built`                         | yes            |

Useful aggregates:

```bash
bun run test          # shared, then server (unit + e2e), then UI
bun run test:server   # server unit + server e2e (fast, no UI build)
bun run typecheck     # tsc --noEmit on shared and server, plus e2e/
bun run lint
bun run format:check
```

Do not confuse `bun run test:e2e` at the root (Playwright) with `bun run --cwd packages/server test:e2e` (the server's Vitest e2e suite).

Before opening a pull request, run `bun run lint`, `bun run format:check`, `bun run build` and `bun run test`. After a dependency or import change, also run `bun run verify:built`: the bundle compiles even when startup fails (for example a missing export), and only this check starts it.

## Server unit tests

Files: `packages/server/src/**/*.spec.ts`, next to the code, run by `packages/server/vitest.config.ts`.

- Follow Nest conventions: get the subject from `Test.createTestingModule(...).compile()` and use `overrideProvider` to replace a dependency.
- Repositories and services run against an in-memory SQLite database: `memoryOrm()` from `src/test-helpers.ts` returns a migrated `MikroORM` on `:memory:`.
- Example specs: `sessions.service.spec.ts`, `login-throttle.spec.ts`, `ui-hub.spec.ts`, `config.spec.ts`, `orm.spec.ts`.
- `compose.spec.ts` reads `docker-compose.yml` and asserts every published port is bound to `127.0.0.1`.

## Server e2e tests

Files: `packages/server/test/*.e2e-spec.ts`, run by `vitest.config.e2e.ts` (20 s timeout: a cold start plus scrypt for the admin account is slow).

| File                                 | Covers                                                                                  |
| ------------------------------------ | --------------------------------------------------------------------------------------- |
| `auth.e2e-spec.ts`                   | Admin bootstrap, login, cookies, CSRF, throttle, invitations, tokens, isolation         |
| `http.e2e-spec.ts`                   | Host/Origin guard, health, the UI's API, the SSE stream                                 |
| `hardening.e2e-spec.ts`              | Security headers, CORS, JSON 404s, logs                                                 |
| `mcp.e2e-spec.ts`                    | The three tools through an in-memory MCP client (no network)                            |
| `mcp-descriptions.e2e-spec.ts`       | Tool descriptions follow the configuration                                              |
| `mcp-nonblocking.e2e-spec.ts`        | Default `wait_seconds` of 0                                                             |

The full application is built with `createTestApplication({ config })` (`src/test-helpers.ts`), which applies the same `setupApplication` as `main.ts`. The application is not initialized for you:

```ts
const app = await createTestApplication({ config: testConfig() });
await app.init();
await app.getHttpAdapter().getInstance().ready();

const response = await app.inject({ method: "GET", url: "/health" });

await app.close();
```

MCP tests use `connectMcpClient(app)` from `@nestjs/mcp/testing`, an in-memory client with no network.

Helpers in `src/test-helpers.ts`:

- `testConfig(overrides)`: a full `AppConfig` for tests: `local` profile, `noOpen: true`, `:memory:` database, `defaultWaitSeconds: 1`, `logLevel: "silent"`. **Never turn `noOpen` off in a test**: the server would open a real browser.
- `createTestApplication`: swaps the `PasswordHasher` for a cheap `logN: 10` scrypt cost.
- `singleQuestion()`, `textQuestion()`: valid question fixtures.
- `memoryOrm()`: see above.

Gotchas:

- SQLite has no WAL in memory. A test that depends on PRAGMA behaviour needs a temporary file (`dbFile`), not `:memory:`.
- Tool descriptions are computed once per process, so one test file has one description set. Put a test that needs a different `AQ_WAIT_SECONDS` or `noOpen` in its own file, or restart the application with `restart(config)` as `mcp.e2e-spec.ts` does where it can.
- Mock `openInBrowser` (`vi.mock("@app/mcp/open.js", ...)`) to assert that the browser would be opened.
- To test the `server` profile, pass `deploymentMode: "server"`, `admin: { username, password }` and an HTTPS-or-loopback `baseUrl` in `testConfig`.

## UI tests

`ng test --no-watch` runs Vitest in jsdom (`@angular/build:unit-test`). Specs sit next to the component (`*.spec.ts`). Test doubles and fixtures are in `packages/ui/src/testing/` (`dom.ts`, `fixtures.ts`).

Gotcha with fake timers: with `vi.useFakeTimers()`, `fixture.whenStable()` can never resolve. Advance the clock with `await vi.advanceTimersByTimeAsync(...)`, then call `fixture.detectChanges()`. This matters for code that polls (`SessionState` every 5 s, the home page every 5 s) and for the autosave delay.

## Browser end-to-end tests

`e2e/` contains Playwright specs that start the **built** server (`dist/index.js`) on a free port with a temporary data directory, then drive Chromium and real MCP clients. Nothing is mocked.

First run:

```bash
bunx playwright install chromium
bun run build
bun run test:e2e
```

| File                    | Covers                                                                                                                                    |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `harness.ts`            | `startServer(env)` (free port, temp directory, waits for `/health`), `callTool`                                                           |
| `local.spec.ts`         | Local profile: styles and CSP without console errors, agent asks / user answers, notes, decline, live tab, late answer, markdown cleanup |
| `server.spec.ts`        | Server profile: login, invitation, multi-user isolation, admin supervision, tokens limited to `/mcp`, session expiry                       |
| `inspector.spec.ts`     | The CLI of `@modelcontextprotocol/inspector` against `/mcp`: a third-party MCP client                                                      |

Specs run in parallel (each test has its own server). On CI there is one retry and traces are kept on failure (uploaded as `playwright-traces`). Locally, traces are written to `test-results/`.

## What CI runs

See [Build and release](build-and-release.md#ci). In short: typecheck, lint, format check, all tests, build, Playwright, package verification on Node and Bun, then the Docker image smoke test.

## Writing tests: guidelines

- A bug fix comes with a test that fails without the fix.
- A new route: add an authentication test (anonymous refused, API token refused if it is a UI route, another user cannot reach it).
- A new repository method on sessions: test that another owner gets nothing.
- Test names in this repository are written in French; keep that for consistency within a file.
