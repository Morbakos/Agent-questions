# --- Build : UI Angular + serveur TypeScript
FROM node:24-slim AS build
WORKDIR /app
COPY package.json ./
COPY server/package.json server/
COPY ui/package.json ui/
RUN npm install
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
COPY server/package.json server/
COPY ui/package.json ui/
RUN npm install --omit=dev -w server
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/ui/dist ui/dist
VOLUME /data
EXPOSE 4317
CMD ["node", "server/dist/index.js"]
