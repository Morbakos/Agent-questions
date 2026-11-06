# Conventions

Conventions that matter when you write code here, then step-by-step recipes for the three most common changes. The workflow for issues and pull requests is in `CONTRIBUTING.md` at the repository root.

## Language

- Code identifiers and MCP tool names and descriptions: English.
- UI text, code comments and error messages shown to users: the existing code uses French. Keep the language of the file you are editing.
- Documentation (this folder) and commit messages: English.

## Formatting and linting

Prettier is enforced (`bun run format` to write, `bun run format:check` to verify). Do not format by hand. The settings in `.prettierrc`: tabs (width 4; 2 spaces in YAML), double quotes, semicolons, trailing commas, 120 columns, one attribute per line in templates. Markdown files are excluded from Prettier (`*.md` is in `.prettierignore`).

ESLint (`bun run lint`, `bun run lint:fix`) enforces, among others:

- `@typescript-eslint/no-explicit-any`: **`any` is forbidden** in server, shared and UI. Use `unknown` and narrow it.
- `curly: "all"`: always braces.
- Angular: `OnPush` change detection on every component, selector prefix `app`.

TypeScript is strict everywhere, with `noUncheckedIndexedAccess` on the server and shared packages.

## Destructure what you use

When a function only uses a few properties of an object it receives, destructure them in the signature, including defaults for options:

```ts
export function relayHintOf({ noOpen, baseUrl }: AppConfig): string { ... }

static register({ config = loadConfig(), hub = new UiHub() }: CoreOptions = {}) { ... }
```

Exceptions: the object is passed on as is, or it is an injected dependency (`this.config`).

## Types and imports

- Types shared by server and UI live in `packages/shared/`. Do not redeclare them. See [Shared package](shared.md).
- Server imports use the `@app/...` and `@server/...` aliases with the `.js` extension. Same-directory imports stay relative. See [Server](server.md#path-aliases).
- Every Nest injection is explicit: `@Inject(Class)`. Entity properties declare their `type`. See [Server](server.md#entities-decorators-and-explicit-injection).
- Do not import `@mikro-orm/*` or entities outside `persistence/`, `core/core.module.ts`, `storage/orm.ts` and tests.

## Prefer a Nest package

For server infrastructure, use a Nest package if one exists; write home-grown code only when none fits, and record why in [Server](server.md#nest-package-first).

## Behaviour changes need docs

After any visible change (an `AQ_*` variable, a tool, a flow), update the README and the relevant pages under `docs/`. Tool and field descriptions are read by models: changing them changes agent behaviour (see [Waiting for answers](waiting-for-answers.md#tool-descriptions-are-prompts)).

## Add an MCP tool

1. In `packages/server/src/app/mcp/api/question-tools.ts`, add a method to `QuestionTools` with `@Tool`. `getAnswers` is the shortest example:

   ```ts
   @Tool({
   	name: "get_answers",
   	title: "Get the answers of a question session",
   	description: "Fetch the answers of a session previously created with ask_user, ...",
   	annotations: { idempotentHint: true, destructiveHint: false, openWorldHint: false },
   	inputSchema: z.object({
   		session_id: z.uuid(),
   		wait_seconds: waitSecondsField(cfg, "..."),
   	}),
   })
   async getAnswers({ session_id, wait_seconds }: { session_id: string; wait_seconds?: number }, context: McpContext<AuthenticatedRequest>) {
   	const owner = this.owner(context);
   	// ...
   }
   ```

2. Take the owner from `this.owner(context)`, never from an argument, and pass it to every service call.
3. Errors reach the agent as a readable tool error (`isError: true`) when they are a Nest `HttpException` (`NotFoundException`, `ConflictException`, `BadRequestException`), or an `HttpError` / `AuthError` thrown by a service: the global `HttpErrorFilter` and `AuthErrorFilter` turn those into a tool result during an MCP call. Any other error becomes "Internal server error".
4. Nothing to register: `@nestjs/mcp` discovers `@Tool` methods.
5. New fields or types go in `packages/shared/src/`.
6. Write tests in `packages/server/test/mcp.e2e-spec.ts` (in-memory client), and update the README and the [MCP tools reference](../reference/mcp-tools.md).

Remember that the description is a prompt, and that it is evaluated at import time (see [Server](server.md#mcp-specifics)).

## Add a controller

1. Create the controller in the right domain under `api/`, and register it in the domain's module (`controllers: [...]`).
2. **Put `@SessionOnly()` on any controller that serves the UI.** Without it an API token would be accepted. Add `@Roles("admin")` for admin-only routes. Use `@Public()` only for routes that must be anonymous (health, login, invitations).
3. Get the user with `@CurrentPrincipal() principal: Principal` and pass `principal.userId` as the owner. Never read it from the body, query or headers.
4. Validate bodies with a shared zod schema (`parseBody(Schema, body)` or `safeParse`) and throw `HttpError(status, message, details?)`.
5. Under a new URL prefix, extend the JSON 404 list in `UnknownRouteController`, otherwise a mistyped URL returns the UI's HTML.
6. Add the route to the hand-written list in the test "aucune route de l'UI n'accepte un jeton d'API" in `packages/server/test/auth.e2e-spec.ts`, and cover isolation between users.
7. Add the call to `core/api.ts` in the UI, and document it in the [HTTP API reference](../reference/http-api.md).

Do not write to the database in a route the UI polls in a loop.

## Add a migration

The schema evolves only through new migrations. **Never edit a migration that has been published.**

1. Create `packages/server/src/app/storage/migrations/migration-00N-<name>.ts` (next number) extending `Migration` from `@mikro-orm/migrations`:

   ```ts
   import { Migration } from "@mikro-orm/migrations";

   export class Migration002AddSomething extends Migration {
   	override up(): void {
   		this.addSql("ALTER TABLE sessions ADD COLUMN something TEXT");
   	}
   }
   ```

2. Register it in `migrationsList` in `storage/orm.ts` with an explicit `name` (a bundler could rename classes, which would change the name recorded in the database):

   ```ts
   const migrationsList = [
   	{ name: "Migration001Initial", class: Migration001Initial },
   	{ name: "Migration002AddSomething", class: Migration002AddSomething },
   ];
   ```

3. Update the entity (`persistence/entities/*.entity.ts` or `sessions/persistence/session.entity.ts`) with an explicit `type`, and the repository and domain types.
4. Migrations run in `StorageBootstrap.onModuleInit`, in order, after the PRAGMAs. Anything that reads the new schema at startup goes in `onApplicationBootstrap`.
5. Test with `memoryOrm()` (which runs all migrations) and update the [data model reference](../reference/data-model.md).

## Add a UI page

See [UI](ui.md#add-a-page).
