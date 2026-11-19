# Satisfactory Planner – ein Image für Web-App und Server.
# Projekte liegen außerhalb des Images im Volume /app/storage (siehe docker-compose.yml).

FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/gamedata-tools/package.json packages/gamedata-tools/
COPY apps/web/package.json apps/web/
COPY apps/server/package.json apps/server/
RUN npm ci --no-audit --no-fund
COPY . .
# Commit für die Versionsanzeige (.git ist nicht im Build-Kontext)
ARG GIT_COMMIT=""
ENV GIT_COMMIT=$GIT_COMMIT
RUN npm run build

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=8080 HOST=0.0.0.0 STORAGE_DIR=/app/storage
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/gamedata-tools/package.json packages/gamedata-tools/
COPY apps/web/package.json apps/web/
COPY apps/server/package.json apps/server/
RUN npm ci --omit=dev --no-audit --no-fund --workspace @satis/server --workspace @satis/core && npm cache clean --force
COPY packages/core/src packages/core/src
COPY apps/server/src apps/server/src
COPY --from=build /app/apps/web/dist apps/web/dist
# Speicherordner gehört dem unprivilegierten Benutzer „node“ (UID 1000)
RUN mkdir -p /app/storage && chown node:node /app/storage
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://localhost:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--import", "tsx", "apps/server/src/main.ts"]
