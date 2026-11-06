# Build and release

## Build order

The UI must be built before the server, because the server build copies the UI into its output.

```bash
bun run build          # ui (ng build), then build:server
bun run build:server   # typecheck + dependency check + bundle (the UI must already be built)
```

`build:server` is `tsc --noEmit -p packages/server && bun scripts/check-deps.ts && bun scripts/build-server.ts`.

Outputs:

- `packages/ui/dist/ui/browser/`: the Angular production build (hashed files, `security.autoCsp`).
- `dist/index.js`: the server bundle (minified, no source map). `dist/ui/`: a copy of the UI.

`bun run start` runs `node dist/index.js`. The server runs on Node >= 22.13 or Bun >= 1.4, because both provide `node:sqlite`. Do not use `bun:sqlite`: it would break Node, `npx` and Vitest. No native dependency is allowed for the same reason (the SQLite dialect is `NodeSqliteDialect`).

## `scripts/build-server.ts`

It bundles `packages/server/src/main.ts` with `Bun.build` (target `node`, ESM) and then checks the result. The bundle is a production artifact: whitespace and syntax are minified, but identifiers are **not** mangled (Nest and MikroORM derive provider and entity names from class names), and no source map is produced, so the original sources are not shipped. Stack traces therefore point into `dist/index.js`; to debug with readable traces, run from sources (`bun run dev:server`). In order, it:

1. Fails if the UI is not built (`packages/ui/dist/ui/browser/index.html` missing). A package without UI would be unusable, so it fails instead of publishing one.
2. Deletes `dist/` and bundles. Every key of the root `dependencies` is `external`; `@agent-questions/shared` is not in them, so it is inlined (it ships as TypeScript).
3. Fails if the version was not injected (see [Releasing](#releasing)) or if the bundle contains `devDependencies`, which would mean the whole `package.json` leaked in.
4. Fails if the bundle still contains an unresolved `@app/` or `@server/` import. This guards the path aliases, see [Server](server.md#path-aliases).
5. Fails if the UI's `index.html` has inline JavaScript without a `<meta http-equiv="Content-Security-Policy">` tag. The server's CSP only allows inline script by hash, so the UI would render unstyled.
6. Copies the UI to `dist/ui`.

At run time the server finds the UI at `dist/ui` next to the bundle (`defaultUiDir`), or in the monorepo through `@agent-questions/ui/browser/index.html`. `AQ_UI_DIR` overrides both.

## `scripts/check-deps.ts`

The published package is the **root** package, `@morbakos/agent-questions`. Its `dependencies` are installed on the user's machine and serve as the bundle's externals. The code, however, declares its dependencies in `packages/server/package.json`. The script requires that **every runtime dependency of `packages/server` appears in the root `dependencies` with the same range**, otherwise the published bundle would crash at startup with "Cannot find package". The root may have more (peers of `@nestjs/mcp`, for example).

When you add a runtime dependency to the server, add it to both files with the same range, then run `bun install`.

## Verifying the built package

The bundle compiles even when startup fails (for example an export that does not exist), so CI and developers also start it:

```bash
bun run build
bun run verify:built
```

`scripts/verify-built.ts` runs `bun pm pack`, then `scripts/verify-package.ts <tarball> node` and `... bun`. For each runtime, `verify-package.ts`:

1. installs the tarball into a temporary project, as a user would;
2. checks that `dist/index.js`, `dist/ui/index.html`, `README.md` and `LICENSE` exist;
3. starts the installed server on a free port (loopback, temporary data directory, `AQ_NO_OPEN=1`);
4. waits up to 20 s for `/health`, fetches `/` and expects HTML, and sends an MCP `initialize` request to `/mcp`.

## Docker

The `Dockerfile` has two stages.

1. **build** (`oven/bun:1.4.4`): installs with `bun install --frozen-lockfile`, runs `bun run build`, packs the root package (`bun pm pack`), runs `verify-package.ts` on Bun, and installs the tarball into `/install`. A startup failure stops the image build.
2. **runtime** (`oven/bun:1.4.4-alpine`): copies `/install`, runs as user `bun` (uid 1000) with `/data` as a volume. It sets `NODE_ENV=production`, `AQ_BIND_HOST=0.0.0.0`, `AQ_IN_CONTAINER=1`, `AQ_NO_OPEN=1` and `AQ_DATA_DIR=/data`, exposes 4317, and has a `HEALTHCHECK` that fetches `/health`. The command is `bun node_modules/@morbakos/agent-questions/dist/index.js`.

The image runs the exact tarball that would be published. Bun is the production runtime, so the image needs neither Node nor a package manager. For deployment, see [Docker](../operations/docker.md). `docker-compose.yml` defines `agent-questions` and an optional `llama` service (a local-model trial, not needed for normal use); `docker compose up -d --build agent-questions` starts only the former.

## CI

`.github/workflows/ci.yml` runs on pull requests (from the same repository, not forks) and on pushes to `main`, with a 20 minute timeout, on Bun 1.4.4 and Node 24:

1. `bun install --frozen-lockfile`
2. `bun run typecheck`
3. `bun run lint`
4. `bun run format:check`
5. `bun run test`
6. `bun run build`
7. Install Chromium, `bun run test:e2e` (Playwright traces uploaded on failure)
8. `bun pm pack`, then `verify-package.ts` on Node and on Bun
9. `docker build`, start the container, check `/health`, insert a session row into `/data`, restart the container and check that the session survived (persistent volume)

Any failing step fails the build; reproduce locally with the same commands.

## Releasing

Versions: the release version is `version` in the root `package.json`. The workspace packages carry their own private versions (`0.1.0`). The MCP server `version` reported to clients comes from the root `package.json`: `scripts/build-server.ts` injects it with the Bun.build `define` option as `__APP_VERSION__`, and `src/app/version.ts` exposes it as `APP_VERSION` (`0.0.0-dev` when running from sources). The bundle holds that one string, not the rest of `package.json`. Bumping the root version is enough; `scripts/verify-package.ts` checks that the installed package announces its own version.

**npm package.** The npm package `@morbakos/agent-questions` is **not published for now**: no workflow or procedure publishes it. The root package still exists as the build unit: the Docker image installs its tarball (`npm pack` output), and `scripts/verify-package.ts` checks that tarball on Node and Bun. `publishConfig` (GitHub Packages) and `prepublishOnly` stay in `package.json` for a future publication.

**Docker image.** `.github/workflows/publish-image.yml` builds and pushes `ghcr.io/morbakos/agent-questions` when a tag `vX.Y.Z` is pushed, or when started manually on an existing tag. It:

1. checks that the ref is a tag and equals `v<version of package.json>`, and fails otherwise;
2. builds the image without pushing, starts it and requires `/health` to answer;
3. logs in to `ghcr.io` and pushes the tags `X.Y.Z`, `X.Y` and `latest`.

A suggested order (nothing enforces it except the tag check above):

1. Update the version in `package.json` and add the entry to `CHANGELOG.md`.
2. Merge to `main` with CI green.
3. Tag `vX.Y.Z` on that commit and push the tag: the image is built and published.
