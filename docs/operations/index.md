# Operations

This section is for people who run Agent Questions for other users: deployment, HTTPS, backups, upgrades, security
and monitoring. For environment variables, see the [configuration reference](../reference/configuration.md).

Everything runs in a **single HTTP process** (web UI, API, SQLite database and the `/mcp` endpoint). Do not run
several replicas against the same database: answers wake waiting agents through an in-memory event emitter, and the
database has one writer.

## Pages

| Page                                          | Content                                                      |
| --------------------------------------------- | ------------------------------------------------------------ |
| [Deployment profiles](deployment-profiles.md) | `local` vs `server`, required variables, first administrator |
| [Docker](docker.md)                           | Image, compose file, volume, health check                    |
| [Reverse proxy](reverse-proxy.md)             | HTTPS, trusted proxies, SSE and long `/mcp` requests         |
| [Backup and upgrade](backup-and-upgrade.md)   | Backing up SQLite, restoring, migrations, image tags         |
| [Security](security.md)                       | Threat model, cookies, CSRF, CSP, throttling, hardening      |
| [Monitoring](monitoring.md)                   | `/health`, log levels, database growth                       |

## Going to production: checklist

1. Use the `server` profile (`AQ_DEPLOYMENT_MODE=server`). The `local` profile has no accounts and must never be
   reachable from a network. See [deployment profiles](deployment-profiles.md).
2. Set `AQ_PUBLIC_URL` to the public **HTTPS** URL and `AQ_DATA_DIR` to a persistent volume. The server refuses to
   start without them.
3. Put a TLS-terminating reverse proxy in front, and set `AQ_TRUST_PROXY` to the number of proxies in front of the
   server. See [reverse proxy](reverse-proxy.md).
4. Do not publish port 4317 to the internet: bind it to `127.0.0.1` (or a private network) and let the proxy reach it.
5. Set `AQ_ADMIN_PASSWORD` for the first start, or read the generated password from the first start's logs, then
   change it in the UI.
6. Back up the volume regularly and test a restore. See [backup and upgrade](backup-and-upgrade.md).
7. Pin the image to a version tag (for example `0.1.1`), not `latest`.
8. Monitor `/health` and keep `AQ_LOG=info`. See [monitoring](monitoring.md).
9. Plan a manual clean-up of old sessions: nothing purges them automatically.
10. Review the [hardening checklist](security.md#hardening-checklist).
