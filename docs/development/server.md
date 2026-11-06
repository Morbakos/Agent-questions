# Server

`packages/server` is a NestJS 12 application on Fastify 5. MCP is served by `@nestjs/mcp` (MCP SDK `@modelcontextprotocol/server` v2), persistence is MikroORM 7 on SQLite through `node:sqlite`.

## Module map

```text
AppModule.register(options)
  CoreModule        config, database, repositories, UiHub (global)
  AuthModule        @nestjs/authentication, providers, accounts, login
  QuestionsMcpModule  /mcp and the QuestionTools methods (async module)
  ServeStaticModule the Angular build, only when the UI directory exists
  SessionsModule    SessionsService + UI and admin controllers
  EventsModule      SSE stream GET /api/events
  TerminusModule    + HealthController (GET /health), UnknownRouteController
```

Entry points:

- `src/main.ts` reads and validates the configuration (`loadConfig`), creates the application, enables shutdown hooks and listens.
- `src/app/application.ts` holds `createApplication`, `createFastifyAdapter` and `setupApplication` (global filters, CSRF, security headers, CORS, HTTP hooks). The e2e tests call the same `setupApplication`, so they mount exactly the production application.

Directory layout of `src/app/`:

| Directory   | Content                                                                                                          |
| ----------- | ---------------------------------------------------------------------------------------------------------------- |
| `core/`     | `core.module.ts`: configuration, ORM, repositories, `UiHub`, exported globally                                   |
| `config/`   | `config.ts` (`loadConfig`, `AQ_*` validation), `app.config.ts` (`@nestjs/config` namespace), `runtime-config.ts` |
| `http/`     | Host/Origin guard, security headers, CORS origins, error filter and `HttpError`, cursor parsing, log levels      |
| `storage/`  | `orm.ts` (options, PRAGMAs, migrations list), `storage-bootstrap.ts`, `migrations/`                              |
| `sessions/` | Question sessions: service, repository, controllers, view mapping                                                |
| `events/`   | `UiHub` and the SSE controller                                                                                   |
| `mcp/`      | `QuestionsMcpModule`, `api/question-tools.ts`, `relay-hint.ts`, `open.ts`, `mcp-error-result.ts`                 |
| `auth/`     | Providers, accounts, invitations, login throttle (see [Authentication](authentication.md))                       |
| `health/`   | `GET /health`                                                                                                    |

## Layering

Each domain (`sessions`, `auth`) is split into layers. A layer imports only layers that are purer than itself.

```text
domain/       pure types and functions (Session, hashQuestions, Principal)
persistence/  repository contract (abstract class) + Mikro implementation + entities/
service       business rules, uses the repository contract only
api/          controllers, guards, decorators, view mapping
```

Rules:

- Services and `api` code import the repository **contract** from `persistence/`, never `@mikro-orm/*` nor the entities. The exceptions are `core/core.module.ts`, `storage/orm.ts` and the tests.
- Services hold the business rules and never touch the ORM.
- One entity per file under `persistence/entities/` (or next to the repository for sessions).

### Repositories

A repository is an abstract class that also serves as the Nest injection token. `CoreModule.register()` wires it to its implementation:

```ts
{ provide: SessionRepository, useClass: MikroSessionRepository }
```

Swapping the storage means changing those `useClass` lines. Conventions every implementation follows:

- All methods are asynchronous.
- Each operation uses a freshly forked `EntityManager` (`this.orm.em.fork()`); `registerRequestContext` is disabled, so no request middleware is needed.
- **Session repository methods take the owner as their first argument and filter on it.** A session of another user is simply not found, even with its id. Isolation is enforced here, not by callers.
- The only exceptions are the read-only `findAnyById` and `listAll`, used for admin supervision. No write method exists without an owner.
- `findOrCreate` is atomic (one transaction), so two identical concurrent calls create a single session.

Services mirror this: they return 404, not 403, for another user's session so its existence is not revealed.

### Entities, decorators and explicit injection

Entities use MikroORM's legacy decorators (`@mikro-orm/decorators/legacy`) with `ReflectMetadataProvider`, and **every property declares its type explicitly**:

```ts
@Property({ type: "string", fieldName: "created_at" })
createdAt!: number;
```

The server is bundled and run with Bun, and tested with Vitest. Neither Bun nor esbuild emits `emitDecoratorMetadata` information, so types cannot be inferred. For the same reason, **every constructor injection is explicit**:

```ts
constructor(@Inject(SessionRepository) private readonly repository: SessionRepository) {}
```

Forgetting `@Inject` compiles but fails at runtime with an unresolved dependency.

Entities are listed explicitly in `storage/orm.ts` (`entities`), as is the migration list: the Bun bundle has no file discovery. A new entity or migration must be added to those lists.

## Path aliases

Imports use `@app/...` (`src/app/...`) and `@server/...` (`src/...`) instead of relative paths. Only files in the same directory use `./`. ESM `NodeNext` requires the `.js` extension:

```ts
import { SessionsService } from "@app/sessions/sessions.service.js";
```

The aliases are declared in **three places that must stay aligned**:

1. `paths` in `packages/server/tsconfig.json`
2. `alias` in `packages/server/vitest.alias.ts` (shared by both Vitest configs)
3. the unresolved-alias check in `scripts/build-server.ts`, which fails the build if the bundle still contains `from "@app/` or `from "@server/`

## Configuration

`loadConfig(env)` in `config/config.ts` validates `process.env` and returns an `AppConfig`, or throws `ConfigError` with a message naming the variable (never its value). It is called once, at the entry point, because the configuration is needed before Nest exists (HTTP adapter, log levels) and when `@Tool` decorators are evaluated. The full variable list is in the [configuration reference](../reference/configuration.md).

Inside Nest, the configuration is injected through the `@nestjs/config` namespace `app`:

```ts
constructor(@Inject(appConfig.KEY) private readonly config: ConfigType<typeof appConfig>) {}
```

There is no `.env` file reading and no `ConfigService`: `ConfigModule.forRoot({ ignoreEnvFile: true, isGlobal: true, load })`.

Safety checks done at startup include: `local` profile only listens on loopback (or `0.0.0.0` when `AQ_IN_CONTAINER=1`), `server` profile requires `AQ_PUBLIC_URL` (HTTPS unless loopback) and `AQ_DATA_DIR`, `AQ_ALLOWED_ORIGINS` rejects wildcards.

## Startup order

1. `loadConfig` validates the environment.
2. `StorageBootstrap.onModuleInit` applies the SQLite PRAGMAs and runs the migrations.
3. Everything that reads the database at startup runs in `onApplicationBootstrap`, which comes after all `onModuleInit` hooks, so the schema exists (for example `AuthService` creating the first admin).

Before the ORM opens the file, `ormOptions` creates the directory and runs `PRAGMA wal_checkpoint(TRUNCATE)` on a throwaway connection (`flushWal`) to merge any WAL left by a hard stop. This cannot be done on the dialect's own connection.

On shutdown, `SessionsService.beforeApplicationShutdown` wakes every waiting tool call (they answer `pending`) while the database is still open, and `UiHub` completes the SSE streams.

## Errors

- Services throw `HttpError(status, message, details?)`; `HttpErrorFilter` turns it into `{ "error": "...", "details": [...] }`.
- Controllers validate bodies with the shared zod schemas (`parseBody` in `auth/api/validate.ts`, or `safeParse`).
- In an MCP tool call, the same filters (`HttpErrorFilter`, `AuthErrorFilter`) return an `HttpError` or `AuthError` as a tool result with `isError: true` and the message, instead of an HTTP reply (`isMcpCall`, `toolError` in `mcp/mcp-error-result.ts`). Nest `HttpException`s (`NotFoundException`, ...) also reach the agent. Any other error becomes a generic "Internal server error", so do not let unexpected exceptions carry information the agent needs.

## Nest package first

When infrastructure is needed, look for a Nest package before writing code: read the Nest docs, search the package, and check it works with Nest 12, Fastify 5, Bun and Node. Home-grown code is kept only when no package fits, and the reason is recorded.

Already in use: `@nestjs/serve-static`, `app.useSecurityHeaders()`, `app.enableCors()`, `@nestjs/terminus`, `@Sse()`, `@nestjs/authentication`, `@nestjs/mcp`, `@nestjs/config` (injection only).

Dependency pins: `@nestjs/authentication` is pinned to `0.1.4` and `@nestjs/mcp` to `0.0.3` (caret on `0.0.x` means exactly that version). Both are 0.x and their API can break; read the changelog before bumping.

Home-grown code that stays, and why:

| Code                                                    | Why no package                                                                                                                                                                                                                               |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `loadConfig`                                            | The config is needed before Nest exists and for decorator evaluation. Tried and dropped: `@nestjs/config`'s `validate` copies keys into `process.env` (on Windows `port` overwrites `PORT`), hides errors with `AQ_LOG=silent`, and does not apply to configs built by tests |
| `EventEmitter` in `SessionsService.wait`                | `@nestjs/event-emitter` has no wait-with-timeout, no `AbortSignal` and no wake-up on shutdown (only `waitFor`)                                                                                                                               |
| `LoginThrottle`                                         | `@nestjs/throttler` does not count failures only, per username and per address                                                                                                                                                               |
| Host/Origin guard, `no-store`, request log (`http-setup.ts`) | No package provides them; an interceptor sees neither guard refusals nor `hijack`ed replies                                                                                                                                             |

## MCP specifics

`QuestionTools` (`mcp/api/question-tools.ts`) holds the `@Tool` methods. Its descriptions depend on the configuration, and a decorator argument is evaluated when the file is imported, before any injection. So:

- `question-tools.ts` is **never imported statically**. `QuestionsMcpModule.register(config)` calls `setRuntimeConfig(config)`, then `await import("./api/question-tools.js")`.
- `getRuntimeConfig()` is for that purpose only. Everywhere else, inject the configuration.
- Descriptions are therefore fixed per process (and per test file).
- `/mcp` is a regular Nest controller route: the global guard authenticates it and `http-setup.ts` checks Host/Origin. The module's own `allowedOrigins` check is disabled so it does not reject origins declared in `AQ_ALLOWED_ORIGINS`. Its `decorators` option restricts `/mcp` to API tokens and the local profile.
- `@nestjs/mcp` replies with `reply.hijack()`, so Fastify's `onResponse` hook does not fire for successful MCP calls. Tools log their own waits under the `mcp` logger.

How to add a tool: see [Conventions](conventions.md#add-an-mcp-tool). Behaviour of the waiting tools: [Waiting for answers](waiting-for-answers.md).

## Logging

One logger only: Nest's `Logger`. Fastify runs with `logger: false`. `AQ_LOG` (`fatal`, `error`, `warn`, `info`, `debug`, `trace`, `silent`) maps to Nest log levels in `http/log-levels.ts`. Requests are logged at `debug`, except `/health`, with secrets masked (`redactUrl` hides invitation tokens). 401 and 403 responses are logged at `warn` with method and path only.

## Health

`GET /health` (public, `@nestjs/terminus`) returns 200 with the database ping result, or 503 when the database does not answer or during shutdown. Docker's `HEALTHCHECK` uses it.
