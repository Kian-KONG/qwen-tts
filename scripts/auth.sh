#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
# shellcheck disable=SC1091
source "$ROOT/scripts/mirrors.sh"

if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

if [[ ! -d "$ROOT/frontend/node_modules" ]]; then
  (cd "$ROOT/frontend" && npm install --no-fund --no-audit --registry "$NPM_CONFIG_REGISTRY")
fi

export AUTH_PORT="${AUTH_PORT:-3001}"
export BETTER_AUTH_URL="${BETTER_AUTH_URL:-http://localhost:8000}"
cd "$ROOT/frontend"
exec npx tsx server/index.ts
