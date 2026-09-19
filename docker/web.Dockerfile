# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/*
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* .npmrc ./
COPY packages ./packages
COPY apps/web/package.json ./apps/web/
COPY apps/api/package.json ./apps/api/
COPY apps/worker/package.json ./apps/worker/
RUN pnpm install --frozen-lockfile=false

FROM deps AS build
ARG NEXT_PUBLIC_API_URL=http://localhost:4000/api
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_TELEMETRY_DISABLED=1
COPY tsconfig.base.json ./
COPY apps/web ./apps/web
RUN pnpm --filter @engloop/db run generate \
 && pnpm -r --filter=./packages/** run build \
 && pnpm --filter @engloop/web run build

FROM base AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY --from=build /app /app
WORKDIR /app/apps/web
EXPOSE 3000
CMD ["pnpm", "start"]
