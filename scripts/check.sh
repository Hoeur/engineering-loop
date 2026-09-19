#!/usr/bin/env bash
# Runs the same gates as CI, in the same order, and stops at the first failure.
set -euo pipefail

cd "$(dirname "$0")/.."

step() { printf '\n\033[36m▸ %s\033[0m\n' "$1"; }

step "Generating the Prisma client"
pnpm db:generate

step "Building shared packages"
pnpm build:packages

step "Lint"
pnpm lint

step "Typecheck"
pnpm -r run typecheck

step "Tests"
pnpm -r run test

step "Build"
pnpm -r --filter=./apps/** run build

printf '\n\033[32m✓ All checks passed.\033[0m\n'
