# Chess Watch — top-level shortcuts. Server targets live in server/Makefile.
.PHONY: help setup config pieces icons web build preview test server

help:
	@echo "Targets:"
	@echo "  make setup    npm install (root + web) + server venv + copy .env.example"
	@echo "  make config   generate shared/config.generated.js from .env"
	@echo "  make pieces   generate piece PNGs"
	@echo "  make icons    generate app icons"
	@echo "  make web      Vite dev server (browser harness)"
	@echo "  make build    config + zeus build"
	@echo "  make preview  config + zeus preview (QR for the Zepp app)"
	@echo "  make server   start the relay server (see server/Makefile)"
	@echo "  make test     vitest (JS) + server pytest"

setup:
	cp -n .env.example .env || true
	cp -n server/.env.example server/.env || true
	# Arch/Omarchy ship libvips; sharp otherwise tries to compile against it
	# and fails without node-addon-api. Force its bundled prebuilt binary.
	SHARP_IGNORE_GLOBAL_LIBVIPS=1 npm install
	npm install --prefix web
	$(MAKE) -C server venv
	@echo "setup done — fill in .env and server/.env, then: make config"

config:
	node scripts/gen-app-config.mjs

pieces:
	node scripts/gen-pieces.mjs

icons:
	node scripts/gen-icons.mjs

web: config
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
