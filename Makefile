.DEFAULT_GOAL := help

# Single source of truth for host port overrides: if infra/.env exists
# (copied from infra/.env.example), both docker-compose and these targets
# read the same POSTGRES_PORT/REDIS_PORT/BACKEND_PORT/FRONTEND_PORT values.
ifneq (,$(wildcard infra/.env))
include infra/.env
export
endif

POSTGRES_PORT ?= 5432
REDIS_PORT    ?= 6379
BACKEND_PORT  ?= 4000
FRONTEND_PORT ?= 5173

COMPOSE       := docker compose -f infra/docker-compose.yml
DEV_DB_URL    := postgres://snapland:snapland@localhost:$(POSTGRES_PORT)/snapland
DEV_REDIS_URL := redis://localhost:$(REDIS_PORT)

.PHONY: help install build lint test test-integration \
        up down restart logs ps \
        dev dev-down dev-storage-up migrate wait-for-storage \
        clean down-volumes

help: ## Show this help
	@echo "Snapland — available targets:"
	@awk 'BEGIN {FS = ":.*## "} /^[a-zA-Z0-9_.-]+:.*## / {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)
	@echo ""
	@echo "Ports (override via infra/.env, see infra/.env.example):"
	@echo "  POSTGRES_PORT=$(POSTGRES_PORT)  REDIS_PORT=$(REDIS_PORT)  BACKEND_PORT=$(BACKEND_PORT)  FRONTEND_PORT=$(FRONTEND_PORT)"

## --- Workspace (no infra needed) -------------------------------------------

install: ## Install all workspace dependencies (pnpm)
	pnpm install

build: ## Build all packages (turbo, cached & dependency-ordered)
	pnpm build

lint: ## Typecheck all packages
	pnpm lint

test: ## Run unit tests (no infra required)
	pnpm test

## --- Containerized deployment (everything in Docker) -----------------------

up: ## Build & start the full stack in Docker (postgres, redis, backend, frontend)
	$(COMPOSE) up --build -d
	@echo "Frontend: http://localhost:$(FRONTEND_PORT)"
	@echo "Backend:  http://localhost:$(BACKEND_PORT)  (/healthz, /readyz, /metrics)"

down: ## Stop the full Docker stack (keeps volumes/data)
	$(COMPOSE) down

restart: down up ## Restart the full Docker stack

logs: ## Tail logs from the full Docker stack
	$(COMPOSE) logs -f

ps: ## Show status of the full Docker stack's containers
	$(COMPOSE) ps

## --- Local dev (apps run natively, only Postgres+Redis are containerized) --

dev: dev-storage-up wait-for-storage migrate ## Run backend+frontend natively against containerized Postgres/Redis
	PORT=$(BACKEND_PORT) \
	DATABASE_URL=$(DEV_DB_URL) \
	REDIS_URL=$(DEV_REDIS_URL) \
	CORS_ORIGIN=http://localhost:$(FRONTEND_PORT) \
	FRONTEND_PORT=$(FRONTEND_PORT) \
	VITE_API_URL=http://localhost:$(BACKEND_PORT) \
	VITE_WS_URL=ws://localhost:$(BACKEND_PORT)/ws \
	pnpm dev

dev-storage-up:
	$(COMPOSE) up -d postgres redis

wait-for-storage:
	@echo "Waiting for Postgres and Redis to be ready..."
	@until $(COMPOSE) exec -T redis redis-cli ping > /dev/null 2>&1; do sleep 1; done
	@until $(COMPOSE) exec -T postgres pg_isready -U snapland -d snapland > /dev/null 2>&1; do sleep 1; done
	@# On a FRESH volume, the postgis image runs init scripts (our
	@# extensions + init.sql) and then restarts Postgres once to apply
	@# them — connecting during that restart is what causes ECONNRESET.
	@# The entrypoint prints "Skipping initialization" immediately (before
	@# ever listening) when reusing existing data, so that message tells us
	@# definitively whether a restart is coming; only then do we wait for
	@# the second (post-restart) "ready to accept connections" line.
	@if $(COMPOSE) logs postgres 2>/dev/null | grep -q "Skipping initialization"; then \
		echo "Reusing existing Postgres data (no restart expected)."; \
	else \
		echo "Fresh Postgres volume: waiting for init scripts + restart to finish..."; \
		until [ "$$($(COMPOSE) logs postgres 2>/dev/null | grep -c 'database system is ready to accept connections')" -ge 2 ]; do sleep 1; done; \
	fi
	@until $(COMPOSE) exec -T postgres psql -U snapland -d snapland -c "SELECT 1" > /dev/null 2>&1; do sleep 1; done
	@echo "Postgres and Redis are ready."

dev-down: ## Stop the containerized Postgres/Redis used by `make dev`
	$(COMPOSE) stop postgres redis

migrate: dev-storage-up wait-for-storage ## Run DB migrations against the containerized Postgres
	@# Retries a few times: a stray local tool polling the Postgres port with
	@# bad credentials (e.g. a pgAdmin saved connection) can occasionally
	@# cause a transient ECONNRESET on the very next connection attempt.
	@for i in 1 2 3; do \
		DATABASE_URL=$(DEV_DB_URL) pnpm --filter @snapland/backend migrate:up && exit 0; \
		echo "migrate attempt $$i failed, retrying..."; sleep 2; \
	done; \
	echo "migrate failed after 3 attempts"; exit 1

## --- Testing against real infra --------------------------------------------

test-integration: dev-storage-up wait-for-storage migrate build ## Run backend integration tests against containerized Postgres/Redis
	DATABASE_URL=$(DEV_DB_URL) REDIS_URL=$(DEV_REDIS_URL) \
	JWT_ACCESS_SECRET=dev-access-secret-change-me-please \
	JWT_REFRESH_SECRET=dev-refresh-secret-change-me-please \
	RUN_INTEGRATION_TESTS=1 pnpm --filter @snapland/backend test

## --- Cleanup -----------------------------------------------------------------

clean: ## Remove build outputs (dist/) across the workspace
	rm -rf apps/backend/dist apps/frontend/dist packages/shared/dist .turbo apps/*/.turbo packages/*/.turbo

down-volumes: ## DESTRUCTIVE: stop the full stack and delete its Postgres data volume
	$(COMPOSE) down -v
