#!/usr/bin/env bash
# One-command dev launcher.
#   scripts/dev.sh start   → start backend (uvicorn) + frontend (vite) in the background
#   scripts/dev.sh stop    → stop both
#   scripts/dev.sh status  → show what is running
#   scripts/dev.sh logs    → tail both logs
# Logs & pids live in .run/ (git-ignored).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RUN="$ROOT/.run"; mkdir -p "$RUN"
[ -f "$ROOT/.env" ] && set -a && . "$ROOT/.env" && set +a
BACKEND_HOST="${BACKEND_HOST:-127.0.0.1}"
BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"
PY="$ROOT/backend/.venv/bin/python"

is_running() { [ -f "$RUN/$1.pid" ] && kill -0 "$(cat "$RUN/$1.pid")" 2>/dev/null; }

start_backend() {
  if is_running backend; then echo "backend already running (pid $(cat "$RUN/backend.pid"))"; return; fi
  [ -x "$PY" ] || { echo "backend venv missing — run scripts/setup.sh first"; exit 1; }
  ( cd "$ROOT/backend" && nohup "$PY" -m uvicorn app.main:app --host "$BACKEND_HOST" --port "$BACKEND_PORT" \
      > "$RUN/backend.log" 2>&1 < /dev/null & echo $! > "$RUN/backend.pid" )
  echo "backend  → http://$BACKEND_HOST:$BACKEND_PORT  (log: .run/backend.log)"
}
start_frontend() {
  if is_running frontend; then echo "frontend already running (pid $(cat "$RUN/frontend.pid"))"; return; fi
  [ -d "$ROOT/frontend/node_modules" ] || { echo "frontend deps missing — run scripts/setup.sh first"; exit 1; }
  ( cd "$ROOT/frontend" && VITE_BACKEND_URL="http://$BACKEND_HOST:$BACKEND_PORT" FRONTEND_PORT="$FRONTEND_PORT" \
      nohup npm run dev -- --port "$FRONTEND_PORT" > "$RUN/frontend.log" 2>&1 < /dev/null & echo $! > "$RUN/frontend.pid" )
  echo "frontend → http://localhost:$FRONTEND_PORT  (log: .run/frontend.log)"
}
stop_one() {
  local name="$1"
  if [ -f "$RUN/$name.pid" ]; then
    local pid; pid="$(cat "$RUN/$name.pid")"
    if kill -0 "$pid" 2>/dev/null; then
      pkill -TERM -P "$pid" 2>/dev/null || true
      kill -TERM "$pid" 2>/dev/null || true
      sleep 0.5
      kill -0 "$pid" 2>/dev/null && kill -KILL "$pid" 2>/dev/null || true
      echo "stopped $name (pid $pid)"
    fi
    rm -f "$RUN/$name.pid"
  fi
}
wait_for() { # url seconds
  for _ in $(seq 1 "$2"); do curl -fsS "$1" >/dev/null 2>&1 && return 0; sleep 1; done; return 1
}

case "${1:-start}" in
  start)
    start_backend; start_frontend
    if wait_for "http://$BACKEND_HOST:$BACKEND_PORT/api/health" 20; then echo "✓ backend healthy"; else echo "✗ backend not healthy yet — check .run/backend.log"; fi
    if wait_for "http://localhost:$FRONTEND_PORT/" 30; then echo "✓ frontend up"; else echo "✗ frontend not up yet — check .run/frontend.log"; fi
    echo; echo "Open http://localhost:$FRONTEND_PORT   •   stop with: scripts/dev.sh stop"
    ;;
  stop) stop_one frontend; stop_one backend ;;
  restart) "$0" stop; "$0" start ;;
  status)
    for n in backend frontend; do if is_running $n; then echo "$n: running (pid $(cat "$RUN/$n.pid"))"; else echo "$n: stopped"; fi; done ;;
  logs) tail -n 50 -f "$RUN/backend.log" "$RUN/frontend.log" ;;
  *) echo "usage: $0 {start|stop|restart|status|logs}"; exit 1 ;;
esac
