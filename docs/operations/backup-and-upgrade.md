# Backup and upgrade

## What to back up

All state is in one SQLite database, `agent-questions.sqlite`, inside `AQ_DATA_DIR` (`/data` in the Docker image,
`~/.agent-questions` by default in the `local` profile). It holds questions and answers, accounts, password hashes,
sign-in sessions, invitations and API token hashes. Nothing else needs saving: configuration is in environment
variables.

The database runs in WAL mode, so next to the main file you may see `agent-questions.sqlite-wal` and
`agent-questions.sqlite-shm`. Recent writes can live only in the `-wal` file: **copying the `.sqlite` file alone from a
running server can give an inconsistent or outdated backup.**

How the server limits this, from `storage/orm.ts`: it opens a single connection, sets `wal_autocheckpoint = 100` and
`journal_size_limit = 262144` (the WAL stays below roughly 400 KB), and runs `wal_checkpoint(TRUNCATE)` on a short-lived
connection before opening the database, which flushes the WAL left by a crash. A clean shutdown closes the database.

## Safe backup: stop, copy, start

The simplest procedure that is always consistent. It costs a short downtime during which agent calls fail and the UI
is unreachable.

```bash
docker compose stop agent-questions
docker run --rm -v ~/.agent-questions:/data:ro -v "$PWD":/backup alpine \
  tar czf /backup/agent-questions-$(date +%F).tgz -C /data .
docker compose start agent-questions
```

The archive contains the database and any remaining `-wal` / `-shm` files, which is what a restore needs. With a bind
mount or a systemd service, stop the process and copy the whole `AQ_DATA_DIR` the same way.

### Without downtime

SQLite allows an online backup from a second process, as long as it goes through SQLite and not a file copy:
`sqlite3 agent-questions.sqlite ".backup 'copy.sqlite'"` or `VACUUM INTO`. The image does not ship the `sqlite3` CLI, so
run it from the host against a bind-mounted `AQ_DATA_DIR`. The server sets `busy_timeout = 5000`, so a brief backup
read does not make it fail. This path is standard SQLite behaviour and is not exercised by the project's tests; verify
a restore of the result before relying on it.

## Restore

```bash
docker compose stop agent-questions
docker run --rm -v ~/.agent-questions:/data -v "$PWD":/backup alpine \
  sh -c 'rm -rf /data/* && tar xzf /backup/agent-questions-2026-01-01.tgz -C /data && chown -R 1000:1000 /data'
docker compose start agent-questions
curl -f http://127.0.0.1:4317/health
```

If you restore a single `.sqlite` file (for example an online backup), delete any `agent-questions.sqlite-wal` and
`agent-questions.sqlite-shm` left in the directory first, otherwise SQLite would replay a WAL that belongs to another
database. The files must be owned by uid 1000 in the Docker image.

After a restore, sign-in sessions and API tokens are those of the backup: users signed in after the backup are signed
out, and tokens created after it no longer exist.

## Upgrading

1. Read the release notes in [`CHANGELOG.md`](../../CHANGELOG.md).
2. **Take a backup** (above). Schema migrations cannot be undone.
3. Change the image tag (for example `0.1.1` to `0.1.2`), then:

   ```bash
   docker compose pull agent-questions
   docker compose up -d agent-questions
   curl -f https://questions.example.com/health
   docker compose logs --tail 50 agent-questions
   ```

4. Pending requests: an agent call waiting with `wait_seconds` is interrupted by the restart and must be retried.
   Calling `ask_user` again with the same title and questions resumes the same session (it is found again by a hash of
   title and questions), and `get_answers` with the `session_id` works as usual.

### Migrations

Schema migrations are applied automatically, at every startup, before the server accepts requests
(`MikroORM migrator.up()`). Only pending ones run. There is currently a single migration, `Migration001Initial`. A
schema change always ships as a **new** migration; published ones are never edited. Migrations are forward-only: no
`down` is defined.

### Rollback

Going back to an older image is safe only if no migration was applied in between. If the new version applied a
migration, the old code may not work with the new schema: restore the backup taken before the upgrade, then start the
older image. Any data written after that backup is lost.

## Versions and tags

The version in the root `package.json` (`@morbakos/agent-questions`) is the single source of truth. The image tags
follow it: pushing the Git tag `v1.2.3` publishes `ghcr.io/morbakos/agent-questions` with the tags `1.2.3`, `1.2` and
`latest`. In production pin `1.2.3`: `1.2` follows patch releases and `latest` follows every release. While the
version is `0.x`, minor releases may include breaking changes, so read the changelog.

## Publishing an image

Workflow `.github/workflows/publish-image.yml`, for maintainers:

1. Bump `version` in `package.json`, commit, and create the Git tag `vX.Y.Z` with exactly that version.
2. Push the tag. The workflow starts on tags matching `v*.*.*`. It can also be started by hand
   (`workflow_dispatch`), but only on a tag, never on a branch.
3. It fails if the tag differs from `package.json`'s version.
4. It builds the image (the Dockerfile itself installs the packed tarball and starts it on Bun as a smoke test),
   starts the finished image, and requires `GET /health` to answer. A failure stops the run **before** anything is
   pushed.
5. It logs in to `ghcr.io` with the workflow's `GITHUB_TOKEN` and pushes the three tags.

Runs for the same ref are serialised and never cancelled. The continuous-integration workflow (`ci.yml`) builds the
image, checks `/health`, and checks that data survives a container restart on a volume.
