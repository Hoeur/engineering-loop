# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends git openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* .npmrc ./
COPY packages ./packages
COPY apps/api/package.json ./apps/api/
COPY apps/worker/package.json ./apps/worker/
COPY apps/web/package.json ./apps/web/
RUN pnpm install --frozen-lockfile=false

FROM deps AS build
COPY tsconfig.base.json ./
COPY apps/api ./apps/api
RUN pnpm --filter @engloop/db run generate \
 && pnpm -r --filter=./packages/** run build \
 && pnpm --filter @engloop/api run build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app /app
WORKDIR /app/apps/api
EXPOSE 4000
CMD ["node", "dist/main.js"]
