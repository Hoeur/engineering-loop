# Shared build stage used by api/worker/web images.
# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends git openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app
