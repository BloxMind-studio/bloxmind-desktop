# ── BloxBot Build System ─────────────────────────────────────────────────
#
# Usage:
#   make build       Build the Electron installer — downloads deps if needed
#   make dev         Run in development mode
#   make clean       Remove build artifacts
#   make deps        Download the pinned OpenCode server
#   make check       Test + type-check + lint
#
# Prerequisites: pnpm, curl, unzip

SHELL := /bin/bash

# ── Versions ─────────────────────────────────────────────────────────────
OPENCODE_VERSION := 1.2.27

# ── Platform detection ───────────────────────────────────────────────────
UNAME_S := $(shell uname -s)
UNAME_M := $(shell uname -m)

ifeq ($(UNAME_S),Darwin)
  ifeq ($(UNAME_M),arm64)
    TARGET       := aarch64-apple-darwin
    OC_ASSET     := opencode-darwin-arm64.zip
    OC_SHA256    := fa680fa79086c7509d3a2c21e49c9264b803da7c0f1b7807ed842b8e37325597
    OC_BIN       := opencode
  else
    TARGET       := x86_64-apple-darwin
    OC_ASSET     := opencode-darwin-x64.zip
    OC_SHA256    := fc719db27acbc817ff2a4df2bbaa788e02976ddc26a96c84de4fdbe663714b8c
    OC_BIN       := opencode
  endif
  SHA256_CHECK := shasum -a 256
else ifeq ($(UNAME_S),Linux)
  TARGET       := x86_64-unknown-linux-gnu
  OC_ASSET     := opencode-linux-x64.tar.gz
  OC_SHA256    := 6fe3820b145857f7ff507d2826058b7acf1fce8258def1498468dd43809e69e8
  OC_BIN       := opencode
  SHA256_CHECK := sha256sum
endif

# ── Paths ────────────────────────────────────────────────────────────────
OPENCODE_BIN   := resources/bin/opencode-$(TARGET)
NODE_MODULES   := node_modules/.pnpm

# ── Default target ───────────────────────────────────────────────────────
.PHONY: build dev clean deps check lint help

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?##' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

build: deps $(NODE_MODULES) ## Build production app bundle
	pnpm package

dev: deps $(NODE_MODULES) ## Run in development mode
	pnpm dev

test: $(NODE_MODULES) ## Run frontend tests
	pnpm test

check: $(NODE_MODULES) ## Type-check + lint + test
	pnpm test
	pnpm typecheck
	pnpm lint

lint: $(NODE_MODULES) ## Lint frontend
	pnpm lint

clean: ## Remove build artifacts (keeps downloaded deps)
	rm -rf dist dist-electron release

nuke: clean ## Remove everything including downloaded deps
	rm -rf resources/bin
	rm -rf node_modules

deps: $(OPENCODE_BIN) ## Download the OpenCode server

# ── Frontend deps ────────────────────────────────────────────────────────

$(NODE_MODULES): package.json pnpm-lock.yaml
	pnpm install --frozen-lockfile
	@touch $@

# ── OpenCode server ─────────────────────────────────────────────────────

$(OPENCODE_BIN):
	@echo "⬇ Downloading OpenCode v$(OPENCODE_VERSION)..."
	@mkdir -p resources/bin /tmp/bloxbot-deps
	curl -fSL --retry 3 \
		"https://github.com/anomalyco/opencode/releases/download/v$(OPENCODE_VERSION)/$(OC_ASSET)" \
		-o "/tmp/bloxbot-deps/$(OC_ASSET)"
	printf '%s  %s\n' "$(OC_SHA256)" "/tmp/bloxbot-deps/$(OC_ASSET)" | $(SHA256_CHECK) -c -
	@echo "📦 Extracting OpenCode server..."
	cd /tmp/bloxbot-deps && if [[ "$(OC_ASSET)" == *.tar.gz ]]; then \
		tar -xzf "$(OC_ASSET)"; \
	else \
		unzip -o "$(OC_ASSET)"; \
	fi
	mv "/tmp/bloxbot-deps/$(OC_BIN)" "$(OPENCODE_BIN)"
	chmod +x "$(OPENCODE_BIN)"
	rm -rf /tmp/bloxbot-deps
	@echo "✓ OpenCode server ready"
