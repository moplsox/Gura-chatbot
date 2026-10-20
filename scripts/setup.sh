#!/usr/bin/env bash
# First-time setup: Python venv (via uv or python -m venv), Node deps, Live2D core + sample model.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "== Environment =="
echo "OS: $(uname -s) $(uname -m)"
command -v python3 >/dev/null || { echo "python3 not found (brew install python@3.12)"; exit 1; }
command -v node >/dev/null || { echo "node not found (brew install node)"; exit 1; }
echo "python: $(python3 --version)  node: $(node --version)  npm: $(npm --version)"
command -v ffmpeg >/dev/null && echo "ffmpeg: yes" || echo "ffmpeg: MISSING (brew install ffmpeg) — needed to decode microphone audio for STT"

echo; echo "== Backend =="
cd "$ROOT/backend"
if command -v uv >/dev/null; then
  uv venv .venv --python ">=3.11" -q || uv venv .venv -q
  uv pip install --python .venv/bin/python -q -e ".[dev]"
  if [ "${WITH_STT:-1}" = "1" ]; then uv pip install --python .venv/bin/python -q -e ".[stt]" || echo "faster-whisper install failed (STT optional)"; fi
else
  python3 -m venv .venv
  .venv/bin/pip install -q -U pip
  .venv/bin/pip install -q -e ".[dev]"
  if [ "${WITH_STT:-1}" = "1" ]; then .venv/bin/pip install -q -e ".[stt]" || echo "faster-whisper install failed (STT optional)"; fi
fi
echo "✓ backend deps installed"

echo; echo "== Frontend =="
cd "$ROOT/frontend" && npm install --no-audit --no-fund
echo "✓ frontend deps installed"

echo; echo "== Live2D assets =="
"$ROOT/scripts/setup_live2d.sh" "${LIVE2D_SAMPLE:-Haru}" || echo "Live2D asset download failed — see message above"

cd "$ROOT"
[ -f .env ] || { cp .env.example .env; echo "Created .env from .env.example — edit it to add your LLM API key."; }
echo; echo "Setup complete. Start with: scripts/dev.sh start"
