#!/usr/bin/env sh
set -eu

APP_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
PID_FILE="$APP_DIR/app.pid"

if [ ! -f "$PID_FILE" ]; then
  echo "not running"
  exit 0
fi

pid="$(cat "$PID_FILE" 2>/dev/null || true)"
if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
  kill "$pid"
  sleep 1
fi

rm -f "$PID_FILE"
echo "stopped"

