#!/bin/sh
# Single-container entrypoint: start the Go backend and the Next.js standalone
# server in the same container. `tini` is PID 1 and forwards signals here, so
# `docker stop` cleanly terminates both processes.

set -eu

NEXOTE_HOME="${NEXOTE_HOME:-/data/nexote}"
NEXOTE_PORT="${NEXOTE_PORT:-8080}"

mkdir -p "$NEXOTE_HOME"

echo "[nexote] backend: home=$NEXOTE_HOME port=$NEXOTE_PORT"
/usr/local/bin/nexote-backend &
BACKEND_PID=$!

# Wait until the backend accepts connections before starting the frontend, so
# the first page load doesn't hit proxying errors. Backoff of 30s max. A port
# check, not an HTTP request: every API route requires a login (401).
READY=0
for _ in $(seq 1 60); do
  if nc -z 127.0.0.1 "$NEXOTE_PORT" 2>/dev/null; then
    READY=1
    break
  fi
  sleep 0.5
done
if [ "$READY" -ne 1 ]; then
  echo "[nexote] WARNING: backend did not become ready in time, continuing anyway"
fi

cleanup() {
  echo "[nexote] shutting down"
  kill -TERM "$BACKEND_PID" 2>/dev/null || true
}
trap cleanup TERM INT

echo "[nexote] frontend: starting server on :${PORT}"
node server.js &
FRONTEND_PID=$!

# Wait on both; if either exits, the shell returns and tini/container ends.
wait "$BACKEND_PID" "$FRONTEND_PID"