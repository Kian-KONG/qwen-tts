#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT/scripts/mirrors.sh"

PORT="${QWEN_TTS_PORT:-8000}"

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "cloudflared is not installed. Run: make tunnel-setup"
  echo "Local access: http://127.0.0.1:${PORT}"
  exit 1
fi

echo "Opening a temporary Cloudflare Tunnel to http://127.0.0.1:${PORT}"
echo "This URL changes every run. For the fixed hostname use: make tunnel"
echo "Keep this process running while you share the URL."
# QUIC is often blocked or flaky in China; http2 is more reliable for quick tunnels.
exec cloudflared tunnel --protocol http2 --url "http://127.0.0.1:${PORT}"
