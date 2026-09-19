.PHONY: help install up down reset dev build lint typecheck test e2e migrate seed logs clean

help: ## Show available targets
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-14s\033[0m %s\n",$$1,$$2}'

install: ## Install workspace dependencies
	pnpm install

up: ## Start postgres + redis (infrastructure only)
	docker compose up -d postgres redis

down: ## Stop all docker services
	docker compose down

reset: ## Stop services and delete volumes
	docker compose down -v

dev: ## Run api + web + worker in watch mode
	pnpm dev

build: ## Build every package and app
	pnpm build

lint: ## Lint the workspace
	pnpm lint

typecheck: ## Typecheck the workspace
	pnpm typecheck

test: ## Run unit + integration tests
	pnpm test

e2e: ## Run Playwright end-to-end tests
	pnpm test:e2e

migrate: ## Apply pending prisma migrations
	pnpm db:deploy

seed: ## Load demo data
	pnpm db:seed

logs: ## Tail docker logs
	docker compose logs -f

clean: ## Remove build output and node_modules
	pnpm clean
