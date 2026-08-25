#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
# shellcheck disable=SC1091
source "$ROOT/scripts/mirrors.sh"
require_apple_silicon

if [[ ! -d mlx-tts-env ]]; then
  echo "Run make setup first"
  exit 1
fi

# shellcheck disable=SC1091
source "$ROOT/mlx-tts-env/bin/activate"
export PYTHONPATH="$ROOT/backend${PYTHONPATH:+:$PYTHONPATH}"
export QWEN_TTS_HOST="${QWEN_TTS_HOST:-127.0.0.1}"
export QWEN_TTS_PORT="${QWEN_TTS_PORT:-8000}"

# shellcheck disable=SC1091
source "$ROOT/scripts/free-port.sh"
free_listen_port "$QWEN_TTS_PORT"

cleanup() {
  kill "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

python -m uvicorn app.main:app --app-dir "$ROOT/backend" --host "$QWEN_TTS_HOST" --port "$QWEN_TTS_PORT" --reload &
BACKEND_PID=$!

(cd "$ROOT/frontend" && npm install --no-fund --no-audit --registry "$NPM_CONFIG_REGISTRY" && npm run dev) &
FRONTEND_PID=$!

echo "Backend  http://127.0.0.1:${QWEN_TTS_PORT}"
echo "Frontend http://127.0.0.1:5173"
wait
