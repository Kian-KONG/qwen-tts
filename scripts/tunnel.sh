#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT/scripts/mirrors.sh"

PORT="${QWEN_TTS_PORT:-8000}"
NAME="${QWEN_TTS_TUNNEL_NAME:-qwen-tts}"
TOKEN_FILE="${HOME}/.cloudflared/${NAME}.token"

if [[ -f "$ROOT/.env" ]]; then
  # shellcheck disable=SC1091
  set -a
  source "$ROOT/.env"
  set +a
fi

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "Cloudflare Tunnel is optional and cloudflared is not installed."
  echo "Local access: http://127.0.0.1:${PORT}"
  echo "To enable a public URL: make tunnel-setup && make tunnel"
  exit 1
fi

# This Mac already has the named-tunnel token → keep tts.efforttracking.online.
if [[ -n "${QWEN_TTS_TUNNEL_TOKEN:-${CLOUDFLARE_TUNNEL_TOKEN:-}}" || -f "$TOKEN_FILE" ]]; then
  echo "Named tunnel token found. Connecting the fixed hostname."
  echo "Public URL: https://tts.efforttracking.online/"
  echo "For a one-off trycloudflare URL instead: make tunnel-quick"
  exec "$ROOT/scripts/tunnel-named.sh"
fi

echo "No named-tunnel token. Opening a temporary trycloudflare URL to http://127.0.0.1:${PORT}"
echo "Keep this process running while you share the URL."
echo "To use the fixed hostname next time: put the Zero Trust token in ~/.cloudflared/${NAME}.token"
# QUIC is often blocked or flaky in China; http2 is more reliable for quick tunnels.
exec cloudflared tunnel --protocol http2 --url "http://127.0.0.1:${PORT}"
