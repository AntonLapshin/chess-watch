# Chess Watch relay server.
#
#   make venv       create server/.venv and install deps (pip; uv not required)
#   make start      start uvicorn (ONE worker), wait until /health answers
#   make stop       stop the server on $(PORT)
#   make restart    stop + start
#   make status     show whether the server is running
#   make logs       tail the server log
#   make test       run pytest
#
# Bind address: make start HOST=127.0.0.1 PORT=8787
# Loopback is the default because Cloudflare Tunnel (or another reverse proxy)
# is expected to be the only way in. Use HOST=0.0.0.0 only for direct LAN access.

HOST    ?= 127.0.0.1
PORT    ?= 8787
VENV    ?= .venv
UVICORN ?= $(VENV)/bin/uvicorn
RUN_DIR := .run
PID_FILE = $(RUN_DIR)/chess-$(PORT).pid
LOG_FILE = $(RUN_DIR)/chess-$(PORT).log
HEALTH_URL = http://127.0.0.1:$(PORT)/api/v1/health

PORT_PID = ss -H -ltnp 'sport = :$(PORT)' 2>/dev/null | \
           sed -n 's/.*pid=\([0-9][0-9]*\).*/\1/p' | head -n 1

IS_SERVER = tr '\0' ' ' < /proc/$(1)/cmdline 2>/dev/null | \
           grep -q 'uvicorn.*app:app'
IS_ON_PORT = tr '\0' ' ' < /proc/$(1)/cmdline 2>/dev/null | \
             grep -q 'uvicorn.*app:app.*--port $(PORT)'

.PHONY: help venv start stop restart status logs test

help:
	@echo "Targets: venv start stop restart status logs test"
	@echo "Override with: make start HOST=127.0.0.1 PORT=8787 (HOST=0.0.0.0 for LAN)"

venv:
	python3 -m venv $(VENV)
	$(VENV)/bin/pip install -q -r requirements.txt
	@echo "venv ready: $(VENV)"

start:
	@mkdir -p $(RUN_DIR)
	@pid=$$($(PORT_PID)); \
	if [ -n "$$pid" ]; then \
	  if $(call IS_SERVER,$$pid); then \
	    echo "server already running (pid $$pid) — $(HEALTH_URL)"; \
	    echo $$pid > $(PID_FILE); exit 0; \
	  fi; \
	  echo "port $(PORT) is already in use by pid $$pid; refusing to start"; exit 1; \
	fi; \
	rm -f $(PID_FILE); \
	if [ ! -x "$(UVICORN)" ]; then \
	  echo "Missing $(UVICORN). Run: make venv"; exit 1; \
	fi; \
	nohup "$(UVICORN)" app:app --host $(HOST) --port $(PORT) --workers 1 --log-level info \
	  >> $(LOG_FILE) 2>&1 & \
	pid=$$!; echo $$pid > $(PID_FILE); \
	printf 'starting server (pid %s) ' "$$pid"; \
	i=0; \
	while [ $$i -lt 50 ]; do \
	  if ! kill -0 "$$pid" 2>/dev/null; then \
	    echo; echo "server exited during startup. Last log lines:"; \
	    tail -n 20 $(LOG_FILE); rm -f $(PID_FILE); exit 1; \
	  fi; \
	  if curl -fsS --max-time 1 $(HEALTH_URL) >/dev/null 2>&1; then \
	    echo "ok"; echo "listening on $(HOST):$(PORT) (log: $(LOG_FILE))"; exit 0; \
	  fi; \
	  printf '.'; sleep 0.2; i=$$((i+1)); \
	done; \
	echo; echo "server did not answer $(HEALTH_URL) within 10 s; see $(LOG_FILE)"; \
	exit 1

stop:
	@pid=$$($(PORT_PID)); \
	if [ -z "$$pid" ]; then \
	  p=$$(cat $(PID_FILE) 2>/dev/null); \
	  if [ -n "$$p" ] && kill -0 "$$p" 2>/dev/null && $(call IS_ON_PORT,$$p); then \
	    pid=$$p; \
	  fi; \
	fi; \
	if [ -z "$$pid" ]; then \
	  echo "server not running on port $(PORT)"; rm -f $(PID_FILE); exit 0; \
	fi; \
	if ! $(call IS_SERVER,$$pid); then \
	  echo "pid $$pid on port $(PORT) is not the server; refusing to stop it"; exit 1; \
	fi; \
	echo "stopping server (pid $$pid)"; \
	kill "$$pid" 2>/dev/null || true; \
	i=0; while kill -0 "$$pid" 2>/dev/null && [ $$i -lt 50 ]; do \
	  sleep 0.2; i=$$((i+1)); \
	done; \
	if kill -0 "$$pid" 2>/dev/null; then \
	  echo "still running after 10 s, sending SIGKILL"; kill -9 "$$pid" 2>/dev/null || true; \
	fi; \
	rm -f $(PID_FILE); echo "stopped"

restart:
	@$(MAKE) --no-print-directory stop
	@$(MAKE) --no-print-directory start

status:
	@pid=$$($(PORT_PID)); \
	if [ -z "$$pid" ]; then \
	  p=$$(cat $(PID_FILE) 2>/dev/null); \
	  if [ -n "$$p" ] && kill -0 "$$p" 2>/dev/null && $(call IS_ON_PORT,$$p); then \
	    pid=$$p; \
	  fi; \
	fi; \
	if [ -n "$$pid" ] && $(call IS_SERVER,$$pid); then \
	  echo "server running (pid $$pid) on $(HOST):$(PORT)"; \
	  if curl -fsS --max-time 2 $(HEALTH_URL) >/dev/null 2>&1; then \
	    echo "health: ok"; \
	  else \
	    echo "health: not answering $(HEALTH_URL)"; exit 1; \
	  fi; \
	else \
	  echo "server not running on port $(PORT)"; exit 1; \
	fi

logs:
	@tail -n 100 -f $(LOG_FILE) 2>/dev/null || echo "no log yet: $(LOG_FILE)"

test:
	$(VENV)/bin/python -m pytest tests -q
