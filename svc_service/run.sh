#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
[ -f .env ] && set -a && . ./.env && set +a
exec .venv/bin/python -m uvicorn svc_server:app --host 127.0.0.1 --port "${SVC_PORT:-8100}"
