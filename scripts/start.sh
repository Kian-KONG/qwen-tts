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

if [[ "${BUILD_FRONTEND:-1}" == "1" && -f frontend/package.json ]]; then
  if [[ ! -d frontend/node_modules ]]; then
    (cd frontend && npm install --registry "$NPM_CONFIG_REGISTRY")
  fi
  (cd frontend && npm run build)
fi

# shellcheck disable=SC1091
source "$ROOT/scripts/free-port.sh"
free_listen_port "$QWEN_TTS_PORT"

exec python -m uvicorn app.main:app --app-dir "$ROOT/backend" --host "$QWEN_TTS_HOST" --port "$QWEN_TTS_PORT"
