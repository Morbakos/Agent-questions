# Configuration reference

Agent Questions is configured only through environment variables prefixed `AQ_`. There is no configuration file and no
`.env` loading: set the variables in the process environment (shell, `docker run -e`, `docker-compose.yml`, systemd
unit). The values are read and validated once, at startup, by `loadConfig` in `packages/server/src/app/config/config.ts`.

On any invalid value the server prints `Invalid configuration: <message>` (the message names the variable, never a
secret) and exits with code 1. Nothing is started in a dangerous combination.

For how to deploy each profile, see [Deployment profiles](../operations/deployment-profiles.md).

## Profiles

`AQ_DEPLOYMENT_MODE` selects one of two profiles. Both run the same code; they differ in authentication and exposure.

| Aspect                  | `local` (default)                                                                  | `server`                                                                               |
| ----------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Intended use            | One user, on their own machine                                                     | Several users, reached over a network behind an HTTPS reverse proxy                    |
| Accounts and login      | None. Every request is the implicit user `local` (role `admin`)                    | Accounts with passwords, session cookie for the UI, personal API tokens for `/mcp`     |
| Listening address       | Loopback only (`127.0.0.1`, `::1`, `localhost`), or `0.0.0.0` inside a container   | Any address                                                                            |
| Required variables      | None                                                                               | `AQ_PUBLIC_URL`, `AQ_DATA_DIR`                                                         |
| Public URL scheme       | Any                                                                                | HTTPS, unless the host is loopback                                                     |
| Browser auto-open       | Yes, unless `AQ_NO_OPEN=1`                                                         | Never (forced)                                                                         |
| First administrator     | Not applicable                                                                     | Created at first start if the database has no account (see `AQ_ADMIN_*`)               |
| Account routes          | Answer `404` (`/auth/login`, `/api/account/*`, `/api/admin/users`, invitations)     | Available                                                                              |
| Session cookie `Secure` | Not applicable                                                                     | Set when `AQ_PUBLIC_URL` starts with `https:`                                          |
| `/mcp` authentication   | Local user                                                                         | `Authorization: Bearer aq_...` (API token)                                             |

Authentication details: [Authentication](../development/authentication.md) and
[Accounts and roles](../guide/accounts-and-roles.md).

## Variables

All variables are optional unless the table says otherwise. Empty strings are not treated as "unset" for the numeric
variables: `AQ_PORT=` is rejected, `AQ_WAIT_SECONDS=` and `AQ_TRUST_PROXY=` evaluate to `0`.

### Core

| Variable                | Default                                  | Accepted values                              | Profile | Effect                                                                                                                                     |
| ----------------------- | ---------------------------------------- | -------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `AQ_DEPLOYMENT_MODE`    | `local`                                  | `local`, `server`                            | both    | Selects the [profile](#profiles).                                                                                                          |
| `AQ_BIND_HOST`          | `127.0.0.1`                              | Any host or IP (server); see below (local)   | both    | Address the HTTP server listens on.                                                                                                        |
| `AQ_PORT`               | `4317`                                   | Integer 1 to 65535                           | both    | TCP port. Also used to build the accepted `Host` values and the default `AQ_PUBLIC_URL`.                                                   |
| `AQ_PUBLIC_URL`         | `http://127.0.0.1:<AQ_PORT>`             | Absolute URL                                 | both    | URL users open in their browser. Used for the session links returned to the agent, invitation links, CORS/Host checks and the cookie `Secure` flag. Trailing slashes are removed. **Required in the `server` profile.** |
| `AQ_DATA_DIR`           | `~/.agent-questions` (home of the user)  | Directory path                               | both    | Directory holding the database `agent-questions.sqlite`. Created if missing. A leading `~` or `~/` is replaced with the user's home directory. **Required in the `server` profile.** |
| `AQ_UI_DIR`             | `dist/ui` next to the bundle, else the built UI package | Directory path                | both    | Folder of the built web UI. Rarely needed. If the folder does not exist, no UI is served.                                                  |

`AQ_BIND_HOST` in the `local` profile must be `127.0.0.1`, `::1`, `[::1]` or `localhost` (case-insensitive). The only
exception is `0.0.0.0` when `AQ_IN_CONTAINER=1`. Any other value stops the server with:
`AQ_BIND_HOST="<value>" is refused in the local profile: use 127.0.0.1, ::1 or localhost (or AQ_DEPLOYMENT_MODE=server, with accounts and passwords, for network exposure).`

In the `server` profile the default is still `127.0.0.1`: set `AQ_BIND_HOST=0.0.0.0` (or the interface of your proxy)
explicitly if the reverse proxy is on another host or container.

### Waiting and browser

| Variable          | Default | Accepted values                | Profile | Effect                                                                                                                                                                                                      |
| ----------------- | ------- | ------------------------------ | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AQ_WAIT_SECONDS` | `0`     | Integer 0 to 3600              | both    | Default of the `wait_seconds` tool parameter. `0`: tools return `pending` at once and the agent chooses to wait. Positive: tools block that long by default. Also changes the tool descriptions seen by agents. |
| `AQ_NO_OPEN`      | unset   | `1` (any other value is ignored) | local   | Do not open the browser when a question session is created. In the `server` profile this is always on, whatever the value. When active, the server asks the agent to give the user the list address first. |

### stdio launcher

Read by `agent-questions --stdio` (see [Connect your agent](../guide/connect-your-agent.md#option-b-stdio-launcher-no-docker)).
It also uses `AQ_PORT` and `AQ_DATA_DIR`, and passes its whole environment to the server it starts.

| Variable     | Default                    | Effect                                                                                                 |
| ------------ | -------------------------- | ------------------------------------------------------------------------------------------------------ |
| `AQ_MCP_URL` | `http://127.0.0.1:<AQ_PORT>/mcp` | Full URL of `/mcp`. A non-loopback host is never started locally: the launcher only attaches to it. |
| `AQ_TOKEN`   | unset                      | API token sent as `Authorization: Bearer <token>` to `/mcp`.                                           |

The server started by the launcher writes its output to `<AQ_DATA_DIR>/server.log` (append) and uses
`<AQ_DATA_DIR>/launcher.lock` to serialise concurrent starts.

### Network and security

| Variable             | Default | Accepted values                                  | Profile | Effect                                                                                                                                                                                                                                      |
| -------------------- | ------- | ------------------------------------------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AQ_ALLOWED_HOSTS`   | empty   | Comma-separated host names (spaces trimmed)      | both    | Extra `Host` header values accepted, in addition to `127.0.0.1`, `localhost` and the host of `AQ_PUBLIC_URL`. A name without a port gets `:<AQ_PORT>` appended; give `name:port` to override. Any other `Host` gets `403`. Typical use: the Docker service name. |
| `AQ_ALLOWED_ORIGINS` | empty   | Comma-separated exact origins (`scheme://host[:port]`) | both | Extra browser origins allowed to call the server (CORS, `Origin` check) and to make cookie-authenticated writes (CSRF trusted origins). No wildcard, no path.                                                                               |
| `AQ_TRUST_PROXY`     | `0`     | Integer 0 to 10                                  | both    | Number of reverse proxies to trust for the client address (`X-Forwarded-For`). `0`: the address of the TCP connection. Set it behind a proxy, otherwise all clients share the proxy address and its login rate limit.                       |
| `AQ_DEV`             | unset   | `1`                                              | both    | Also accepts the Angular dev server origins `http://localhost:4200` and `http://127.0.0.1:4200`. For development only (`bun run dev:server` sets it).                                                                                       |

Accepted `Host` values are exactly: `127.0.0.1:<port>`, `localhost:<port>`, each `AQ_ALLOWED_HOSTS` entry (with `:<port>`
appended when it has none) and the host of `AQ_PUBLIC_URL` as written (port included only if non-default). Accepted
`Origin` values are the `http://` forms of the same local and allowed hosts, the origin of `AQ_PUBLIC_URL`, the
dev-server origins when `AQ_DEV=1`, and `AQ_ALLOWED_ORIGINS`. A request without an `Origin` header is not checked on
origin. `[::1]` is not in the default list: add it to `AQ_ALLOWED_HOSTS` if you use it.

### First administrator (server profile)

Only read in the `server` profile. They apply once, when the database contains no account.

| Variable            | Default | Accepted values                                                          | Effect                                                                                                                                                              |
| ------------------- | ------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AQ_ADMIN_USERNAME` | `admin` | 3 to 40 characters: letters, digits, `.`, `-`, `_`; first one a letter or digit | User name of the first administrator. An empty value means `admin`.                                                                                       |
| `AQ_ADMIN_PASSWORD` | unset   | 10 to 200 characters                                                     | Password of the first administrator. When unset or empty, a random password is generated and printed **once** in the logs (`warn` level) of the first start. Changing it later has no effect. |

At that first start, question sessions created before accounts existed (owner `local`) are attached to the new
administrator.

### Logging

| Variable | Default | Accepted values                                                   | Profile | Effect                                                                                                             |
| -------- | ------- | ----------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------ |
| `AQ_LOG` | `info`  | `fatal`, `error`, `warn`, `info`, `debug`, `trace`, `silent`      | both    | Log level of the single application logger. `debug` adds one line per HTTP request (except `/health`). `silent` disables all application logs (a configuration error is still printed on stderr). `trace` maps to Nest's `verbose` level. |

### Container and build variables

| Variable          | Default | Accepted values | Effect                                                                                                                                                                       |
| ----------------- | ------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AQ_IN_CONTAINER` | unset   | `1`             | Lets the `local` profile listen on `0.0.0.0` (the published port, bound to `127.0.0.1` on the host, then limits exposure). Set by the Docker image. Has no other effect.    |

The Docker image sets `AQ_BIND_HOST=0.0.0.0`, `AQ_IN_CONTAINER=1`, `AQ_NO_OPEN=1`, `AQ_DATA_DIR=/data` and
`NODE_ENV=production` (not read by the application). See [Docker](../operations/docker.md).

## Startup validation errors

| Condition                                                                 | Message                                                                                                        |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `AQ_DEPLOYMENT_MODE` is neither `local` nor `server`                       | `AQ_DEPLOYMENT_MODE must be "local" or "server" (received: "<value>").`                                       |
| `AQ_PORT` not an integer in 1-65535                                       | `AQ_PORT must be a valid TCP port (1-65535).`                                                              |
| Non-loopback `AQ_BIND_HOST` in the local profile                           | `AQ_BIND_HOST="<value>" is refused in the local profile: ...` (see above)                                         |
| `AQ_ALLOWED_ORIGINS` contains `*`                                         | `AQ_ALLOWED_ORIGINS accepts no wildcard: list the exact origins.`                                      |
| An `AQ_ALLOWED_ORIGINS` entry is not a URL                                | `AQ_ALLOWED_ORIGINS is not a valid URL.`                                                                 |
| An `AQ_ALLOWED_ORIGINS` entry has a path, trailing slash or is not an origin | `AQ_ALLOWED_ORIGINS: "<value>" must be an origin (scheme, host, port) without a path.`                  |
| `AQ_WAIT_SECONDS` not an integer in 0-3600                                | `AQ_WAIT_SECONDS must be an integer between 0 and 3600.`                                                         |
| `AQ_TRUST_PROXY` not an integer in 0-10                                   | `AQ_TRUST_PROXY must be the number of trusted reverse proxies (0 to 10).`                                  |
| `AQ_LOG` not in the list                                                  | `AQ_LOG must be one of: fatal, error, warn, info, debug, trace, silent.`                                 |
| `AQ_ADMIN_USERNAME` invalid (server)                                      | `AQ_ADMIN_USERNAME: 3 to 40 characters (letters, digits, dot, hyphen, underscore).`                          |
| `AQ_ADMIN_PASSWORD` length out of range (server, first admin creation)    | `AQ_ADMIN_PASSWORD must be between 10 and 200 characters long.` (only when the admin is created, not at each start) |
| `AQ_PUBLIC_URL` missing (server)                                          | `The server profile requires AQ_PUBLIC_URL (public URL, HTTPS behind the reverse proxy).`                     |
| `AQ_PUBLIC_URL` not a URL                                                 | `AQ_PUBLIC_URL is not a valid URL.`                                                                      |
| `AQ_PUBLIC_URL` not HTTPS and host not loopback (server)                  | `AQ_PUBLIC_URL must be HTTPS in the server profile.`                                                           |
| `AQ_DATA_DIR` missing (server)                                            | `The server profile requires AQ_DATA_DIR (persistent volume dedicated to the SQLite database).`                               |

Loopback hosts for the HTTPS exception are `127.0.0.1`, `::1`, `[::1]` and `localhost`.

## Examples

Local profile with a fixed port, no browser:

```bash
AQ_PORT=4400 AQ_NO_OPEN=1 bun run start
```

Server profile behind a reverse proxy that terminates TLS (values mirror `.env.server.example`):

```bash
export AQ_DEPLOYMENT_MODE=server
export AQ_PUBLIC_URL=https://questions.example.com
export AQ_DATA_DIR=/data
export AQ_ADMIN_USERNAME=admin
export AQ_BIND_HOST=0.0.0.0
export AQ_TRUST_PROXY=1
node dist/index.js
```

The two example files, `.env.local.example` and `.env.server.example`, list the same variables. They are templates:
the server does not read a `.env` file, so export them (or pass them with `docker run --env-file`) yourself.

## Related

- [Deployment profiles](../operations/deployment-profiles.md)
- [Reverse proxy](../operations/reverse-proxy.md): `AQ_TRUST_PROXY`, `AQ_ALLOWED_HOSTS`, `AQ_PUBLIC_URL`
- [Security](../operations/security.md)
