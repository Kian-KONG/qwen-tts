#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT/scripts/mirrors.sh"

PORT="${QWEN_TTS_PORT:-8000}"
NAME="${QWEN_TTS_TUNNEL_NAME:-qwen-tts}"
CF_DIR="${HOME}/.cloudflared"
CONFIG="${CF_DIR}/${NAME}.yml"
ID_FILE="${CF_DIR}/${NAME}.id"

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "cloudflared is not installed. Run: make tunnel-setup"
  exit 1
fi

if [[ ! -f "${CF_DIR}/cert.pem" ]]; then
  echo "Named tunnels need a Cloudflare account (one-time browser login):"
  echo "  cloudflared tunnel login"
  echo "Then rerun: make tunnel-named"
  exit 1
fi

mkdir -p "$CF_DIR"

tunnel_id_from_list() {
  cloudflared tunnel list 2>/dev/null | awk -v name="$NAME" '$2 == name { print $1; exit }'
}

if [[ -f "$ID_FILE" ]]; then
  TUNNEL_ID="$(tr -d '[:space:]' < "$ID_FILE")"
else
  TUNNEL_ID="$(tunnel_id_from_list || true)"
fi

if [[ -z "${TUNNEL_ID}" ]]; then
  echo "Creating named tunnel ${NAME} ..."
  cloudflared tunnel create "$NAME"
  TUNNEL_ID="$(tunnel_id_from_list)"
fi

if [[ -z "${TUNNEL_ID}" ]]; then
  echo "Could not determine tunnel id for ${NAME}"
  exit 1
fi

printf '%s\n' "$TUNNEL_ID" > "$ID_FILE"
CREDS="${CF_DIR}/${TUNNEL_ID}.json"
if [[ ! -f "$CREDS" ]]; then
  echo "Missing credentials file: $CREDS"
  echo "Try: cloudflared tunnel create ${NAME}"
  exit 1
fi

HOSTNAME="${QWEN_TTS_TUNNEL_HOSTNAME:-${TUNNEL_ID}.cfargotunnel.com}"

cat > "$CONFIG" <<EOF
tunnel: ${TUNNEL_ID}
credentials-file: ${CREDS}
protocol: http2
ingress:
  - hostname: ${HOSTNAME}
    service: http://127.0.0.1:${PORT}
  - service: http://127.0.0.1:${PORT}
EOF

ORIGIN="https://${HOSTNAME}"
echo "Named tunnel ${NAME} -> http://127.0.0.1:${PORT}"
echo "Public API origin: ${ORIGIN}"
echo "Put that URL in the GitHub repo variable VITE_API_BASE, then GitHub Pages can call this Mac."
echo "If ${HOSTNAME} does not resolve, add a Public Hostname in Cloudflare Zero Trust"
echo "or: cloudflared tunnel route dns ${NAME} <subdomain.your-domain>"
echo "Keep this process running (and rerun after reboot)."

exec cloudflared tunnel --config "$CONFIG" --protocol http2 run "$NAME"
