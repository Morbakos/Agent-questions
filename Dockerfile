# --- Build : workspaces autonomes + bundle distribuable à la racine
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/ui/package.json packages/ui/
# --legacy-peer-deps : sans lui, npm 10.9 plante sur les peer dependencies d'Angular 21
# npm ci : versions du lockfile (sans lui, les dépendances plus récentes font échouer le typecheck)
RUN npm ci --legacy-peer-deps
COPY . .
RUN npm run build

# --- Runtime : bundle racine et dépendances de production uniquement
FROM node:24-slim AS runtime
LABEL org.opencontainers.image.source="https://github.com/Morbakos/Agent-questions" \
      org.opencontainers.image.licenses="MIT"
ENV NODE_ENV=production \
    AQ_BIND_HOST=0.0.0.0 \
    AQ_NO_OPEN=1 \
    AQ_DATA_DIR=/data
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --workspaces=false --legacy-peer-deps \
    && mkdir -p /data \
    && chown -R node:node /app /data
COPY --from=build --chown=node:node /app/dist ./dist
VOLUME /data
EXPOSE 4317
USER node
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.AQ_PORT||4317)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
