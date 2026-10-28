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
export QWEN_TTS_HOST="${QWEN_TTS_HOST:-0.0.0.0}"
export QWEN_TTS_PORT="${QWEN_TTS_PORT:-8000}"
export AUTH_PORT="${AUTH_PORT:-3001}"
export AUTH_UPSTREAM="${AUTH_UPSTREAM:-http://127.0.0.1:${AUTH_PORT}}"
export BETTER_AUTH_URL="${BETTER_AUTH_URL:-http://localhost:${QWEN_TTS_PORT}}"

if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

if [[ "${BUILD_FRONTEND:-1}" == "1" && -f frontend/package.json ]]; then
  if [[ ! -d frontend/node_modules ]]; then
    (cd frontend && npm install --registry "$NPM_CONFIG_REGISTRY")
  fi
  (cd frontend && npm run build)
fi

# shellcheck disable=SC1091
source "$ROOT/scripts/free-port.sh"
free_listen_port "$QWEN_TTS_PORT"
free_listen_port "$AUTH_PORT"

cleanup() {
  kill "${AUTH_PID:-}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

"$ROOT/scripts/auth.sh" &
AUTH_PID=$!

python -m uvicorn app.main:app --app-dir "$ROOT/backend" --host "$QWEN_TTS_HOST" --port "$QWEN_TTS_PORT"
