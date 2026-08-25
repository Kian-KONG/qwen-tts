#!/usr/bin/env bash
# Stop whatever is already listening on a TCP port (previous make start / uvicorn).

free_listen_port() {
  local port="${1:?port required}"
  local pids attempt

  pids="$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null || true)"
  if [[ -z "$pids" ]]; then
    return 0
  fi

  echo "Stopping previous process on :${port} (pid $(echo "$pids" | tr '\n' ' '))"
  # shellcheck disable=SC2086
  kill $pids 2>/dev/null || true

  for attempt in $(seq 1 25); do
    pids="$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null || true)"
    if [[ -z "$pids" ]]; then
      return 0
    fi
    sleep 0.2
  done

  echo "Force killing leftover process on :${port} (pid $(echo "$pids" | tr '\n' ' '))"
  # shellcheck disable=SC2086
  kill -9 $pids 2>/dev/null || true
  sleep 0.2
}
