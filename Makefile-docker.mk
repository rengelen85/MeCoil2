# ── Docker ────────────────────────────────────────────────────────────────────
#
# Build/run helpers plus host-based lint & format for the Docker + Caddy configs.
# The lint/format of the configs is wired into the central `make lint` / `make fmt`
# targets (see lint-configs / fmt-configs below) and needs no container — just the
# hadolint + caddy binaries (install with `make config-tools`).

.PHONY: container-info docker-prereqs config-tools \
        lint-configs fmt-configs docker-build docker-test docker-up docker-down

# Docker CLI + Compose plugin. Override with ENGINE=... / COMPOSE=... if needed.
ENGINE ?= docker
COMPOSE ?= $(ENGINE) compose

IMAGE ?= mecoil:latest
TEST_PORT ?= 3999

# Prettier ships with the client dev deps (installed by `make install`).
PRETTIER ?= client/node_modules/.bin/prettier

# Arch mapping for the prebuilt tool downloads (dev host may be amd64 or arm64).
UNAME_M := $(shell uname -m)
CADDY_ARCH := $(if $(filter aarch64 arm64,$(UNAME_M)),arm64,amd64)
HADOLINT_ARCH := $(if $(filter aarch64 arm64,$(UNAME_M)),arm64,x86_64)

# ── Environment prep ──────────────────────────────────────────────────────────

# Show which engine/compose the container targets will use.
container-info:
	@echo "ENGINE   = $(ENGINE)"
	@echo "COMPOSE  = $(COMPOSE)"
	@echo "IMAGE    = $(IMAGE)"
	@if ! command -v $(ENGINE) >/dev/null 2>&1; then \
		echo "Docker not found — run 'make docker-prereqs'."; \
	else \
		$(ENGINE) --version; \
	fi

# Install Docker Engine + Compose plugin on Ubuntu/Debian (official script).
docker-prereqs:
	curl -fsSL https://get.docker.com | sudo sh
	sudo usermod -aG docker $$USER
	@echo "Log out and back in (or run 'newgrp docker') so group membership applies."

# Install the host lint/format tools for the Docker + Caddy configs (no container).
config-tools:
	sudo curl -fsSL -o /usr/local/bin/hadolint \
		https://github.com/hadolint/hadolint/releases/latest/download/hadolint-Linux-$(HADOLINT_ARCH)
	sudo chmod +x /usr/local/bin/hadolint
	sudo curl -fsSL -o /usr/local/bin/caddy \
		"https://caddyserver.com/api/download?os=linux&arch=$(CADDY_ARCH)"
	sudo chmod +x /usr/local/bin/caddy
	@hadolint --version && caddy version

# ── Config lint / format (host-based, called by `make lint` / `make fmt`) ──────

# Lint the Dockerfile (hadolint), the Caddyfile (caddy validate) and the compose
# file (prettier --check). Missing hadolint/caddy degrade to a warning so a plain
# `make lint` still works before `make config-tools` has been run.
lint-configs:
	@if command -v hadolint >/dev/null 2>&1; then \
		hadolint Dockerfile && echo "Dockerfile: clean"; \
	else \
		echo "⚠  hadolint not installed — skipping Dockerfile lint (run: make config-tools)"; \
	fi
	@if command -v caddy >/dev/null 2>&1; then \
		if out=$$(MECOIL_DOMAIN=localhost caddy validate --adapter caddyfile --config infra/docker/Caddyfile 2>&1); then \
			echo "Caddyfile: valid"; \
		else echo "$$out"; exit 1; fi; \
	else \
		echo "⚠  caddy not installed — skipping Caddyfile validate (run: make config-tools)"; \
	fi
	$(PRETTIER) --check docker-compose.yml

# Auto-format the Caddyfile (caddy fmt) and the compose file (prettier --write).
# The Dockerfile has no standard formatter; hadolint (via lint-configs) enforces
# its style instead.
fmt-configs:
	@if command -v caddy >/dev/null 2>&1; then \
		caddy fmt --overwrite infra/docker/Caddyfile && echo "Caddyfile: formatted"; \
	else \
		echo "⚠  caddy not installed — skipping Caddyfile fmt (run: make config-tools)"; \
	fi
	$(PRETTIER) --write docker-compose.yml

# ── Build / run ───────────────────────────────────────────────────────────────

# Build the game-server image.
docker-build:
	$(ENGINE) build -t $(IMAGE) .

# Build, then smoke-test: run the container on plain HTTP and check that the
# health endpoint (/) returns 200, then tear the container down.
docker-test: docker-build
	@set -e; \
	cid=$$($(ENGINE) run -d -e NO_HTTPS=1 -p $(TEST_PORT):3000 $(IMAGE)); \
	echo "Started container $$cid on port $(TEST_PORT)"; \
	trap "$(ENGINE) rm -f $$cid >/dev/null 2>&1 || true" EXIT; \
	code=""; \
	for i in $$(seq 1 20); do \
		code=$$(curl -s -o /dev/null -w '%{http_code}' http://localhost:$(TEST_PORT)/ 2>/dev/null || true); \
		if [ "$$code" = "200" ]; then echo "docker-test: OK (health returned 200)"; exit 0; fi; \
		sleep 1; \
	done; \
	echo "docker-test: FAILED (last status: $${code:-no response})"; \
	$(ENGINE) logs $$cid; \
	exit 1

# Bring the full stack (app + Caddy) up / down via compose. Caddy binds 80/443,
# which Docker handles via its daemon (no sudo needed).
docker-up:
	$(COMPOSE) up -d --build

docker-down:
	$(COMPOSE) down
