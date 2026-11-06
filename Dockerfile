# Build with Bun (the repository's only package manager) and install the exact root package tarball,
# dependencies included, in the build stage: the runtime image only needs Bun to run it.
FROM oven/bun:1.4.4 AS build
WORKDIR /app
COPY package.json bun.lock ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/ui/package.json packages/ui/
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile
COPY . .
RUN bun run build
RUN bun pm pack --destination /tmp
# Smoke test: the bundle compiles even when startup fails (for example a missing export). So we install the tarball
# and start the server on Bun, the image's runtime, before producing the image: a failure stops the build.
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun scripts/verify-package.ts /tmp/morbakos-agent-questions-*.tgz bun
RUN --mount=type=cache,target=/root/.bun/install/cache \
    mkdir /install \
    && printf '{"private":true,"type":"module"}' > /install/package.json \
    && bun add --cwd /install /tmp/morbakos-agent-questions-*.tgz

# Bun is the production runtime: it provides the built-in node:sqlite API the server uses, so the image needs
# neither Node nor a package manager at run time. The `bun` user (uid 1000) owns /data, as `node` did before.
FROM oven/bun:1.4.4-alpine AS runtime
LABEL org.opencontainers.image.source="https://github.com/Morbakos/agent-questions" \
      org.opencontainers.image.licenses="MIT"
ENV NODE_ENV=production \
    AQ_BIND_HOST=0.0.0.0 \
    AQ_IN_CONTAINER=1 \
    AQ_NO_OPEN=1 \
    AQ_DATA_DIR=/data
WORKDIR /app
COPY --from=build --chown=bun:bun /install/ ./
RUN mkdir -p /data && chown bun:bun /data
VOLUME /data
EXPOSE 4317
USER bun
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=5 \
  CMD bun -e "fetch('http://127.0.0.1:'+(process.env.AQ_PORT||4317)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["bun", "node_modules/@morbakos/agent-questions/dist/index.js"]
