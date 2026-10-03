# Image for sandboxed agent runs (AGENT_EXECUTION_RUNTIME=container) and their
# per-run egress proxy. The runtime starts it read-only, as a non-root uid, with
# every capability dropped; nothing here runs as root at agent time.
#
#   docker build -f docker/agent-sandbox.Dockerfile -t engloop/agent-sandbox:local .
FROM node:22-bookworm-slim@sha256:43ac6c60b8f89723f746e8a92ce91abd5017e627ce1ddfe4238355d3a30b772c

ARG CODEX_VERSION=0.160.0
ARG CLAUDE_CODE_VERSION=2.1.288

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git ripgrep \
  && rm -rf /var/lib/apt/lists/*

RUN npm install --global --omit=dev \
    "@openai/codex@${CODEX_VERSION}" \
    "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" \
  && npm cache clean --force \
  && corepack enable

ENV CI=true \
    DISABLE_AUTOUPDATER=1 \
    NO_UPDATE_NOTIFIER=1

USER 65534:65534
WORKDIR /workspace
ENTRYPOINT ["sleep", "infinity"]
