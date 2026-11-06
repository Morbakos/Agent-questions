# Contributing

Thanks for your interest in Agent Questions. This page covers the workflow; the code itself is documented in
[docs/development](docs/development/index.md).

By participating you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Reporting bugs and requesting features

- Bugs and feature requests: open an issue with the matching template.
- Security vulnerabilities: open an issue with the "Security vulnerability" template (reports are public). See
  [SECURITY.md](SECURITY.md).
- For a bug, include the version (`package.json`), how you run the server (Docker or source; Node or Bun), the
  deployment profile (`local` or `server`), the agent client, steps to reproduce, and the relevant server log
  (`AQ_LOG=debug` adds HTTP requests; never paste tokens or passwords).
  [Troubleshooting](docs/guide/troubleshooting.md) covers common problems.

## Setup

Requirements: [Bun](https://bun.sh) 1.4 or later (the only package manager), Node 22.13 or later (runtime of the
Vitest and Angular tooling).

```bash
git clone https://github.com/Morbakos/agent-questions.git
cd agent-questions
bun install
```

The repository is a Bun monorepo: `packages/shared` (types and schemas), `packages/server` (NestJS, MCP, SQLite) and
`packages/ui` (Angular). See [architecture](docs/development/architecture.md).

## Development loop

```bash
bun run dev:server   # server with reload on :4317 (AQ_DEV=1 accepts the ng serve origin)
bun run dev:ui       # Angular dev server on :4200, proxies /api to :4317
bun run test:server  # fast: server and shared tests only
```

Run the production build locally with `bun run build` then `bun run start`. More in
[server](docs/development/server.md), [UI](docs/development/ui.md) and [testing](docs/development/testing.md).

## Before opening a pull request

Run these on the exact state you submit; CI runs them too (plus typecheck and the Playwright end-to-end tests).

```bash
bun run lint
bun run format:check      # bun run format fixes it (Prettier)
bun run build
bun run test
```

Also:

- `bun run verify:built` after `bun run build` when you change a dependency or an import: the bundle can compile while
  the server fails to start (for instance a missing export).
- `bun run typecheck` and, for changes that touch the UI or the built server, `bunx playwright install chromium` once
  then `bun run test:e2e`.
- A new runtime dependency of `packages/server` must also be declared in the root `package.json` with the same range
  (`scripts/check-deps.ts` enforces it during `build:server`).
- Schema changes need a new migration; never edit a published one.
- Update the documentation when behaviour visible to users changes (environment variable, tool, flow).

## Branches, commits, pull requests

- Branch from `main` and open the pull request against `main`. CI runs on pull requests from this repository and on
  pushes to `main`.
- Commit messages are in English, in the imperative mood, with a short subject line.
- Keep a pull request focused on one change, and describe what changed and why. Add or update tests with the change.
- Add a line under `[Unreleased]` in [CHANGELOG.md](CHANGELOG.md) for user-visible changes.

## Conventions

Code style is enforced by Prettier and ESLint. Other rules (English for documentation and new comments, French for UI
texts, no `any`, explicit injections) are in [conventions](docs/development/conventions.md).

## Releases

Maintainers publish; see [build and release](docs/development/build-and-release.md).
