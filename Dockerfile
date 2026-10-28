# --- Build : paquet partagé, UI Angular, serveur TypeScript
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

# --- Exécution : serveur + UI construite, dépendances de production du serveur seulement
FROM node:24-slim
LABEL org.opencontainers.image.source="https://github.com/Morbakos/Agent-questions" \
      org.opencontainers.image.licenses="MIT"
WORKDIR /app
ENV NODE_ENV=production \
    AQ_BIND_HOST=0.0.0.0 \
    AQ_NO_OPEN=1 \
    AQ_DATA_DIR=/data
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/ui/package.json packages/ui/
RUN npm ci --omit=dev --legacy-peer-deps -w @morbakos/agent-questions
COPY --from=build /app/packages/server/dist packages/server/dist
VOLUME /data
EXPOSE 4317
CMD ["node", "packages/server/dist/index.js"]
