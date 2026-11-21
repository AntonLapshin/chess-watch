# Chess Watch — top-level shortcuts. Backend targets live in worker/.
# `make web` points the browser harness at the local Worker dev server
# (http://localhost:8787) unless CHESS_SERVER_URL is set in the environment
# or on the command line, e.g.:
#   CHESS_SERVER_URL=<your Worker URL> make web
#
# wrangler is a worker devDependency (installed by `make setup` into
# worker/node_modules/.bin); every wrangler invocation below goes through
# `npx` from worker/ or a make target — no global install needed. (Or:
# `cd worker && npx wrangler <cmd>`, or `npm install -g wrangler` if you
# prefer bare commands.)
CHESS_SERVER_URL ?= http://localhost:8787

.PHONY: help setup config pieces icons web build preview test worker-dev worker-test worker-deploy worker-secrets worker-logs

help:
	@echo "Targets:"
	@echo "  make setup    npm install (root + web + worker) + copy .env.example"
	@echo "  make config   generate shared/config.generated.js from .env"
	@echo "  make pieces   generate piece PNGs"
	@echo "  make icons    generate app icons"
	@echo "  make web      Vite dev server (browser harness, local Worker)"
	@echo "  make build    config + zeus build"
	@echo "  make preview  config + zeus preview (QR for the Zepp app)"
	@echo "  make worker-dev      local Worker dev server (port 8787)"
	@echo "  make worker-test     worker unit + integration tests"
	@echo "  make worker-deploy   deploy the Worker (route from CHESS_SERVER_URL)"
	@echo "  make worker-secrets  set the production bearer tokens (interactive)"
	@echo "  make worker-logs     tail the deployed Worker logs"
	@echo "  make test     root vitest + worker vitest"

setup:
	cp -n .env.example .env || true
	cp -n worker/.dev.vars.example worker/.dev.vars || true
	# Arch/Omarchy ship libvips; sharp otherwise tries to compile against it
	# and fails without node-addon-api. Force its bundled prebuilt binary.
	SHARP_IGNORE_GLOBAL_LIBVIPS=1 npm install
	npm install --prefix web
	npm install --prefix worker
	@echo "setup done — wrangler $$(./worker/node_modules/.bin/wrangler --version 2>/dev/null || echo '(not found)') is available via make worker-* / cd worker && npx wrangler"
	@echo "next: fill in .env and worker/.dev.vars, then: make config"

config:
	node scripts/gen-app-config.mjs

pieces:
	node scripts/gen-pieces.mjs

icons:
	node scripts/gen-icons.mjs

web:
	# CHESS_SERVER_URL defaults to the local Worker dev server above;
	# the harness talks to it through the Vite /api proxy. Run
	# `make worker-dev` in another terminal first.
	CHESS_SERVER_URL=$(CHESS_SERVER_URL) node scripts/gen-app-config.mjs
	CHESS_SERVER_URL=$(CHESS_SERVER_URL) npm run dev --prefix web

build:
	npm run config
	npx @zeppos/zeus-cli build

preview:
	npm run config
	npx @zeppos/zeus-cli preview

worker-dev:
	npm run dev --prefix worker

worker-test:
	npm test --prefix worker
	npm run test:workers --prefix worker

worker-deploy:
	bash scripts/worker-deploy.sh

worker-secrets:
	@echo "Set the production bearer tokens (values never printed here)."
	@echo "You will be prompted for each token; paste the values from .env."
	cd worker && npx wrangler secret put CHESS_TOKEN_P1
	cd worker && npx wrangler secret put CHESS_TOKEN_P2

worker-logs:
	npm run tail --prefix worker

test:
	npx vitest run --config vitest.config.mjs
	npm test --prefix worker
