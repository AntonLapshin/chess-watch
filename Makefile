# Chess Watch — top-level shortcuts. Server targets live in server/Makefile.
.PHONY: help setup config pieces icons web build preview test server

help:
	@echo "Targets:"
	@echo "  make setup    npm install + server venv + copy .env.example"
	@echo "  make config   generate shared/config.generated.js from .env"
	@echo "  make pieces   generate piece PNGs"
	@echo "  make icons    generate app icons"
	@echo "  make web      Vite dev server (browser harness)"
	@echo "  make build    config + zeus build"
	@echo "  make preview  config + zeus preview (QR for the Zepp app)"
	@echo "  make server   start the relay server (see server/Makefile)"
	@echo "  make test     vitest (JS) + server pytest"

setup:
	npm install
	$(MAKE) -C server venv
	cp -n .env.example .env || true
	cp -n server/.env.example server/.env || true
	@echo "setup done — fill in .env and server/.env, then: make config"

config:
	node scripts/gen-app-config.mjs

pieces:
	node scripts/gen-pieces.mjs

icons:
	node scripts/gen-icons.mjs

web:
	npm run dev --prefix web

build:
	npm run config
	npx @zeppos/zeus-cli build

preview:
	npm run config
	npx @zeppos/zeus-cli preview

server:
	$(MAKE) -C server start

test:
	npx vitest run --config vitest.config.mjs
	$(MAKE) -C server test
