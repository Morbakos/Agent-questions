# Shared package

`packages/shared` (`@agent-questions/shared`) is the single source of truth for the types and rules that the server and the UI both depend on. Do not redeclare these types elsewhere.

## No build step

The package ships TypeScript. Its `exports` points at the source:

```json
{ "type": "module", "sideEffects": false, "exports": { ".": "./src/index.ts" } }
```

After you change a file in `packages/shared/src/`, there is nothing to build: the server (Vitest, Bun bundler) and the UI (Angular build, which includes `../shared/src/**/*.ts` in `tsconfig.app.json`) read the source directly. The server bundle inlines the package (`scripts/build-server.ts` leaves only root `dependencies` external).

## Contents

| File          | Content                                                                                                                                                                                  |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schema.ts`   | zod 4 schemas: `OptionSchema`, `QuestionSchema` (the input schema of the MCP tools), `AnswerSchema`, `AnswersSchema`, `DeclineSchema` and their inferred types                           |
| `answers.ts`  | Pure logic without zod: `emptyAnswer`, `isRequired`, `allowsOther`, `allowsNotes`, `isAnswered`, `validateAnswers`                                                                       |
| `accounts.ts` | Schemas and types for accounts: roles, username and password rules, login, invitation, tokens, `AuthMe`, `UserSummary`, `UserInvitation`                                                 |
| `limits.ts`   | Constants without dependencies (`PASSWORD_MIN_LENGTH` = 10, `PASSWORD_MAX_LENGTH` = 200)                                                                                                  |
| `views.ts`    | The contract of the UI's API: `SessionView`, `SessionSummary`, `SessionHistory`, admin views, `UiNewSessionEvent`, `ApiError`, `Status`                                                  |
| `index.ts`    | Re-exports everything                                                                                                                                                                    |

Question limits live in `QuestionSchema`: 1 to 30 questions per call, up to 20 options, `prompt` up to 20,000 characters, `context_markdown` up to 200,000, ids matching `^[a-z0-9_]{1,64}$`. The full list is in the [MCP tools reference](../reference/mcp-tools.md).

## What the UI may import at runtime

The UI must not pull zod into its bundle. The package is marked `sideEffects: false` so the bundler can drop what is unused, and the rule is:

- At runtime the UI imports only from `answers.ts` (pure logic) and the constants in `limits.ts`.
- Everything else is imported with `import type`, which is erased at compile time.

Do not import a zod schema (`QuestionSchema`, `LoginSchema`, ...) from UI code. If the UI needs a rule that a schema encodes, extract the rule as a plain function or constant in `answers.ts` or `limits.ts` and have the schema use it. `PASSWORD_MIN_LENGTH` is the model: the schema and the UI forms both import it.

`validateAnswers` runs on both sides. The UI uses it to block submission, the server runs it again on `POST /api/sessions/:id/answers` and answers 422 with the list of errors. Its messages are user-facing and in French.

## Changing a schema

1. Edit `schema.ts` or `accounts.ts`. Field `.describe(...)` text is part of the MCP tool schema that agents read, so treat it like a prompt (see [Waiting for answers](waiting-for-answers.md#tool-descriptions-are-prompts)).
2. If the change affects stored data (`questions`, `draft` and `answers` are JSON columns), consider old rows. A schema tightening can make stored sessions invalid; see the [data model](../reference/data-model.md).
3. If it changes what the UI receives, update `views.ts`.
4. Run `bun run typecheck` (it covers shared, server and `e2e`), then the tests: `packages/shared/src/schema.test.ts` runs through the root `vitest.config.ts`.
5. Update the [MCP tools reference](../reference/mcp-tools.md) and the README if the change is visible to users.
