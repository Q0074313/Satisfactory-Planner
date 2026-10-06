# Satis Planner – ein Image für Web-App und Server.
# Zugangsdaten werden ausschließlich zur Laufzeit über Umgebungsvariablen übergeben.

FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/gamedata-tools/package.json packages/gamedata-tools/
COPY apps/web/package.json apps/web/
COPY apps/server/package.json apps/server/
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=8080 HOST=0.0.0.0
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/gamedata-tools/package.json packages/gamedata-tools/
COPY apps/web/package.json apps/web/
COPY apps/server/package.json apps/server/
RUN npm ci --omit=dev --workspace @satis/server --workspace @satis/core && npm cache clean --force
COPY packages/core/src packages/core/src
COPY apps/server/src apps/server/src
COPY apps/server/drizzle apps/server/drizzle
COPY data data
COPY --from=build /app/apps/web/dist apps/web/dist
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://localhost:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--import", "tsx", "apps/server/src/main.ts"]
