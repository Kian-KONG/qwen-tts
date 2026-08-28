#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
# shellcheck disable=SC1091
source "$ROOT/scripts/mirrors.sh"
require_apple_silicon

brew_install() {
  local formula="$1"
  if command -v "$formula" >/dev/null 2>&1; then
    return 0
  fi
  echo "Installing $formula..."
  brew install "$formula" || echo "Warning: brew install $formula failed (network). Continuing."
}

brew_install ffmpeg

if [[ "${INSTALL_TUNNEL:-0}" == "1" ]]; then
  brew_install cloudflared
else
  echo "Skipping cloudflared (optional). Install later with: make tunnel-setup"
fi

PYTHON_BIN="${PYTHON_BIN:-$HOME/.local/bin/python3.12}"
if [[ ! -x "$PYTHON_BIN" ]]; then
  PYTHON_BIN="$(command -v python3.12 || true)"
fi
if [[ -z "$PYTHON_BIN" ]]; then
  echo "Python 3.12 is required. Install with: uv python install 3.12"
  exit 1
fi

UV_BIN="${UV_BIN:-$HOME/.local/bin/uv}"
if [[ ! -x "$UV_BIN" ]]; then
  UV_BIN="$(command -v uv || true)"
fi
if [[ -z "$UV_BIN" ]]; then
  echo "uv is required. Install from https://docs.astral.sh/uv/"
  exit 1
fi

if [[ ! -d "$ROOT/mlx-tts-env" ]]; then
  "$UV_BIN" venv --python "$PYTHON_BIN" "$ROOT/mlx-tts-env"
fi

# shellcheck disable=SC1091
source "$ROOT/mlx-tts-env/bin/activate"
"$UV_BIN" pip install \
  --index-url "$PIP_INDEX_URL" \
  --extra-index-url "$UV_EXTRA_INDEX_URL" \
  -r "$ROOT/backend/requirements.txt"

mkdir -p "$ROOT/models" "$ROOT/data/voices" "$ROOT/data/scripts" "$ROOT/data/output"
echo "Setup complete on Apple Silicon / MLX."
echo "Next: make download"
