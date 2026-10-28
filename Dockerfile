# --- Build : paquet partagé, UI Angular, serveur TypeScript
FROM node:24-slim AS build
WORKDIR /app
COPY package.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/ui/package.json packages/ui/
# --legacy-peer-deps : sans lui, npm 10.9 plante sur les peer dependencies d'Angular 21
RUN npm install --legacy-peer-deps
COPY . .
RUN npm run build

# --- Exécution : serveur + UI construite, dépendances de production du serveur seulement
FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production \
    AQ_BIND_HOST=0.0.0.0 \
    AQ_NO_OPEN=1 \
    AQ_DATA_DIR=/data
COPY package.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/ui/package.json packages/ui/
RUN npm install --omit=dev --legacy-peer-deps -w @agent-questions/server
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/packages/server/dist packages/server/dist
COPY --from=build /app/packages/ui/dist packages/ui/dist
VOLUME /data
EXPOSE 4317
CMD ["node", "packages/server/dist/index.js"]
