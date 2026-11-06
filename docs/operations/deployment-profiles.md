# Deployment profiles

The profile is chosen with `AQ_DEPLOYMENT_MODE` (`local` by default, or `server`). Any other value stops the server at
startup. All variables are read once, at startup, and validated: an invalid or dangerous combination prevents the
server from starting and the error (`Invalid configuration: ...`) names the variable to fix.

| Aspect             | `local`                                         | `server`                                                   |
| ------------------ | ----------------------------------------------- | ---------------------------------------------------------- |
| Intended for       | One user on their own machine                   | Several users over a network                               |
| Authentication     | None: one fixed implicit user                   | Accounts, passwords, session cookie, API tokens for `/mcp` |
| Bind address       | Loopback only (`127.0.0.1`, `::1`, `localhost`) | Any (`AQ_BIND_HOST`)                                       |
| Browser auto-open  | Yes, unless `AQ_NO_OPEN=1`                      | Never                                                      |
| Required variables | None                                            | `AQ_PUBLIC_URL` (HTTPS), `AQ_DATA_DIR`                     |
| `/mcp` access      | Open to whoever can reach the port              | `Authorization: Bearer aq_...` API token                   |

## Local profile

No variable is required. The server listens on `127.0.0.1:4317` and stores its database in
`~/.agent-questions/agent-questions.sqlite` (`AQ_DATA_DIR` changes the directory). A non-loopback `AQ_BIND_HOST` is
refused at startup, with one exception: inside the official image (`AQ_IN_CONTAINER=1`, set by the Dockerfile),
`0.0.0.0` is accepted because the compose file publishes the port on the host's `127.0.0.1` only (see
[Docker](docker.md)).

There is no authentication: anyone who can open the port can read and answer every question. Do not expose it,
including through a tunnel or a proxy.

Template: [`.env.local.example`](https://github.com/Morbakos/agent-questions/blob/main/.env.local.example).

## Server profile

Required variables (the server refuses to start without them):

| Variable             | Rule                                                                                        |
| -------------------- | ------------------------------------------------------------------------------------------- |
| `AQ_DEPLOYMENT_MODE` | `server`                                                                                    |
| `AQ_PUBLIC_URL`      | URL users type in their browser. HTTPS, unless the host is loopback.                        |
| `AQ_DATA_DIR`        | Directory of the SQLite file `agent-questions.sqlite`. Mount a dedicated persistent volume. |

Common optional variables: `AQ_BIND_HOST` (default `127.0.0.1`; use `0.0.0.0` in a container, or the private address
your proxy connects to), `AQ_PORT` (default `4317`), `AQ_ALLOWED_HOSTS`, `AQ_ALLOWED_ORIGINS`, `AQ_TRUST_PROXY`,
`AQ_LOG`. The full list, with defaults and validation rules, is in the
[configuration reference](../reference/configuration.md).

`AQ_PUBLIC_URL` matters beyond display. It is the base of the links returned to agents and of invitation links; its
host is always accepted in the `Host` header; its origin is accepted by the CORS and CSRF checks; and an `https:` URL
enables the `Secure` session cookie and the HSTS header. A trailing slash is removed.

Template: [`.env.server.example`](https://github.com/Morbakos/agent-questions/blob/main/.env.server.example). The server
does **not** read `.env` files: pass the variables through your process manager, or with `docker run --env-file`.

### First administrator

When the server starts in the `server` profile and the database has **no account at all**, it creates one
administrator:

- Username: `AQ_ADMIN_USERNAME`, default `admin`. 3 to 40 characters: letters, digits, `.`, `-`, `_`, starting with a
  letter or digit.
- Password: `AQ_ADMIN_PASSWORD` (10 to 200 characters). If unset, a random password is generated and printed **once**
  in the startup logs, at `warn` level: `Compte administrateur créé : identifiant « admin », mot de passe « ... »`.
  Only its hash is stored. Change it after the first sign-in.

Both variables are ignored once any account exists. `AQ_ADMIN_USERNAME` is still format-checked at every start.
`AQ_ADMIN_PASSWORD` is length-checked only when the first administrator is created: an out-of-range value prevents
that first start, but a leftover bad value never prevents later starts. Remove the variable after the first start.

Other accounts are created by an administrator in the UI, through single-use invitation links. See
[accounts and roles](../guide/accounts-and-roles.md).

### Switching an existing database from local to server

Sessions created under the `local` profile belong to the fixed implicit user. At the first start in the `server`
profile (database without accounts), they are reassigned to the new administrator, and a log line reports how many.
