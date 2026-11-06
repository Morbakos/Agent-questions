# Docker

## The image

Published by the [release workflow](backup-and-upgrade.md#publishing-an-image) as
`ghcr.io/morbakos/agent-questions`, with the tags `X.Y.Z`, `X.Y` and `latest`. It is built from the repository's
`Dockerfile` in two stages: the UI and server are built and the exact npm package tarball is installed, then copied into
`oven/bun:1.4.4-alpine`. Bun is the runtime (it provides `node:sqlite`); there is no Node and no package manager in the
final image.

Defaults set by the image:

| Setting            | Value                                                          |
| ------------------ | -------------------------------------------------------------- |
| `AQ_BIND_HOST`     | `0.0.0.0`                                                      |
| `AQ_IN_CONTAINER`  | `1` (lets the `local` profile bind `0.0.0.0`)                  |
| `AQ_NO_OPEN`       | `1`                                                            |
| `AQ_DATA_DIR`      | `/data` (declared as a `VOLUME`)                               |
| `NODE_ENV`         | `production`                                                   |
| Exposed port       | `4317`                                                         |
| User               | `bun` (uid 1000), which owns `/data`                           |
| Health check       | `GET /health` every 10 s, 5 s timeout, 30 s start period, 5 retries (uses `AQ_PORT`) |

With no other variable the container runs the **`local` profile**: no authentication. Publish its port on the host's
loopback only (`127.0.0.1:4317:4317`), never on `0.0.0.0`. For a shared deployment, use the `server` profile.

## Quick start (local profile)

```bash
docker compose up -d --build agent-questions
```

The repository's `docker-compose.yml` builds the image, publishes `127.0.0.1:4317:4317`, stores data in the host directory
`~/.agent-questions` (bind mount on `/data`), uses `restart: unless-stopped`, and sets:

- `AQ_ALLOWED_HOSTS=agent-questions`: accepts the Docker service name in the `Host` header, so other containers of the
  same compose project can call `http://agent-questions:4317/mcp`.
- `AQ_PUBLIC_URL=http://127.0.0.1:4317`: the address given to agents and users. Because the browser is never opened in a
  container (`AQ_NO_OPEN=1`), the agent is told to relay this address to the user.
- `AQ_ALLOWED_ORIGINS=http://localhost:8080,http://127.0.0.1:8080`: lets the llama.cpp web UI call `/mcp` from a browser.

The port is published on the Docker host's loopback. A client on another machine (for instance Windows talking to a
Linux VM) cannot reach it without an SSH tunnel.

## Server profile with Docker

Run the published image behind a reverse proxy (see [reverse proxy](reverse-proxy.md)). A minimal compose file:

```yaml
services:
  agent-questions:
    image: ghcr.io/morbakos/agent-questions:0.1.1
    restart: unless-stopped
    environment:
      AQ_DEPLOYMENT_MODE: server
      AQ_PUBLIC_URL: https://questions.example.com
      AQ_TRUST_PROXY: "1"
      # AQ_ADMIN_PASSWORD: set for the first start only, or read the generated one from the logs
    ports:
      - "127.0.0.1:4317:4317"
    volumes:
      - ~/.agent-questions:/data
```

`AQ_DATA_DIR` (`/data`) and `AQ_BIND_HOST` (`0.0.0.0`) come from the image. If the proxy runs in the same compose
project, drop `ports` and let it reach `agent-questions:4317` on the compose network.

Notes:

- **Volume**: `/data` must be persistent and dedicated. SQLite needs a local filesystem with working file locking
  (avoid network shares). With a bind mount, make the directory writable by uid 1000: `chown 1000:1000 ./data`.
- **Health check**: the image already defines it, and the repository's compose file repeats it. Both read `AQ_PORT`
  (default `4317`), so changing the port needs no change to the health check.
- **Restart policy**: use `unless-stopped` (or `always`). Every agent connects to this one process, so it should come
  back after a crash or reboot. Shutdown is graceful: pending waits are released and the database is closed.
- **Upgrades**: see [backup and upgrade](backup-and-upgrade.md).

## Coexistence with the stdio launcher

A client declared with `npx ... --stdio` attaches to the Docker server when it answers on `127.0.0.1:<AQ_PORT>` (4317 by
default; the port must be published on loopback). With Docker stopped, the launcher starts its own server on the same
port, with the database in `~/.agent-questions`. A `docker run` that mounts `-v ~/.agent-questions:/data` (as in the
quick start, and in the repository's `docker-compose.yml`) uses that same directory, so every mode shares one
database. Never run two servers at once.

## The llama.cpp service (optional)

`docker-compose.yml` also defines a `llama` service (`ghcr.io/ggml-org/llama.cpp:server`) used to try Agent Questions
with a local model. It is **not needed** by any other client. It downloads
`NobodyWho/Mistral_Ministral-3-8B-Instruct-GGUF:Q4_K_M` into the `llama-models` volume, listens on
`127.0.0.1:8080`, and starts with `--jinja` (required for tool calls) and `--webui-mcp-proxy`. The latter is only needed
if the browser is blocked by CORS when calling `/mcp` directly. Start only the question server with
`docker compose up -d --build agent-questions` to skip it.
