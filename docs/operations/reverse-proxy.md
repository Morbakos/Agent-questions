# Reverse proxy

The server speaks plain HTTP. In the `server` profile, put a reverse proxy in front of it to terminate TLS. Users and
agents then use the public HTTPS URL, which you also give to the server as `AQ_PUBLIC_URL`.

```
browser / agent --HTTPS--> reverse proxy --HTTP--> agent-questions :4317
```

## What the server expects from the proxy

1. **The original `Host` header.** The server returns `403 {"error":"Host non autorisé"}` for any `Host` it does not
   know. Accepted hosts: `127.0.0.1` and `localhost` (on `AQ_PORT`), the entries of `AQ_ALLOWED_HOSTS` (a name without a
   port gets `AQ_PORT` appended), and the host of `AQ_PUBLIC_URL`. If your proxy rewrites `Host` to the upstream name,
   either keep the original or list the rewritten value in `AQ_ALLOWED_HOSTS`.
2. **The original `Origin` header**, untouched. A browser request whose `Origin` is not the public origin, a loopback
   origin, or listed in `AQ_ALLOWED_ORIGINS` gets `403 {"error":"Origin non autorisée"}`.
3. **`X-Forwarded-For`**, set by the proxy, and `AQ_TRUST_PROXY=<n>` on the server, where `n` is the number of proxies
   between the client and the server. With the default `0`, the server sees the proxy's address for every client, so
   all users share the same sign-in rate-limit bucket (10 failures per 15 minutes per address) and the address in
   logs is useless. Do not set it higher than the real number of proxies: a client could then forge its address.
4. **Long-lived responses not cut or buffered.** See below.

TLS-related behaviour does not depend on `X-Forwarded-Proto`: the `Secure` cookie flag and HSTS are driven by the scheme
of `AQ_PUBLIC_URL`. HSTS is sent (`max-age=31536000`, no `includeSubDomains`) only when that URL is HTTPS.

## Long-lived requests

Two kinds of requests stay open for a long time:

- `GET /api/events`: the Server-Sent Events stream used by the UI. The server sends a keep-alive comment every 15 s and
  closes the stream when the account signs out, is disabled, or the login expires; the UI reconnects.
- `POST /mcp` with `wait_seconds` set on `ask_user`, `get_answers` or `update_questions`: the call stays open until the
  user answers or the delay (at most 3600 s) elapses. By default (`AQ_WAIT_SECONDS=0`) calls return immediately.

So the proxy must not buffer responses, and its upstream read timeout must exceed the longest wait you allow (3600 s
plus margin). Nothing in the application terminates idle connections earlier.

## nginx

```nginx
server {
    listen 443 ssl;
    http2 on;
    server_name questions.example.com;

    ssl_certificate     /etc/ssl/questions.example.com/fullchain.pem;
    ssl_certificate_key /etc/ssl/questions.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:4317;
        proxy_http_version 1.1;

        # Keep the public Host and Origin; add the client address.
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

        # The application accepts bodies up to 10 MiB (large ask_user payloads); nginx's default is only 1 MiB.
        client_max_body_size 10m;

        # SSE and long /mcp calls
        proxy_buffering off;
        proxy_read_timeout 3700s;
        proxy_send_timeout 3700s;
    }
}
```

`nginx` passes the `Origin` header through by default. Use `$http_host` instead of `$host` if the public URL has a
non-default port, because `$host` drops the port and the server compares `Host` including it. Set `AQ_TRUST_PROXY=1`.

## Caddy

```caddyfile
questions.example.com {
    reverse_proxy 127.0.0.1:4317 {
        flush_interval -1
    }
}
```

Caddy obtains the certificate itself, forwards the original `Host` and `Origin`, and adds `X-Forwarded-For`.
`flush_interval -1` flushes every write immediately, which keeps the SSE stream live. Caddy applies no upstream
read timeout by default, and no request body limit (the application's own 10 MiB limit applies). Set
`AQ_TRUST_PROXY=1`.

## Request size

The server rejects request bodies above **10 MiB** with `413` (`Request body is too large`). That covers the largest
`ask_user` the schema allows (about 8 MB). A proxy or gateway in front must allow at least 10 MiB, otherwise it answers
`413` first (nginx's default `client_max_body_size` is 1 MiB).

These snippets are reference configurations, not tested by the project's CI.

## Checking the setup

```bash
curl -i https://questions.example.com/health
```

Expect `200` with `{"status":"ok",...}`. Then sign in from a browser and confirm the page shows no blank screen or `403`
on `/api/...` calls. If an agent client fails to connect while the UI works, check that its URL is
`https://questions.example.com/mcp` and that its `Authorization: Bearer aq_...` header reaches the server
(see [troubleshooting](../guide/troubleshooting.md)).

## Chaining proxies

With a CDN or load balancer in front of your proxy, count both: `AQ_TRUST_PROXY=2`. Each proxy must append to
`X-Forwarded-For`. Remember the database allows a single server process: do not load-balance across several
instances.
