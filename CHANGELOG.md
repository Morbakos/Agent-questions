# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `agent-questions --stdio`: launcher for MCP clients that start servers over stdio. It attaches to the shared HTTP server,
  starts a detached one when none runs, and bridges stdio to `/mcp`. New variables `AQ_MCP_URL` and `AQ_TOKEN`.

### Changed

- Startup, configuration and script messages (terminal output) are now in English; the UI and API error messages stay
  in French.
- Documentation rewritten in English and reorganised under `docs/` (guide, operations, reference, development).

## [0.1.1]

Current version in `package.json`. The git history starts with a single initial commit, so this entry describes the
state of the project at that point rather than a list of changes.

### Added

- MCP server (Streamable HTTP on `/mcp`) with the tools `ask_user`, `get_answers` and `update_questions`.
- Angular web UI: pending list, question form with drafts, read-only history, live follow of the agent over SSE.
- Two deployment profiles: `local` (no account) and `server` (accounts, invitations, API tokens, admin supervision).
- SQLite storage through `node:sqlite`; runs on Node 22.13 or later and Bun 1.4 or later.
- Docker image `ghcr.io/morbakos/agent-questions`. The npm package `@morbakos/agent-questions` is not published.

[Unreleased]: https://github.com/Morbakos/agent-questions/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/Morbakos/agent-questions/releases/tag/v0.1.1
