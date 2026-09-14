#!/usr/bin/env sh
set -eu

APP_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
PID_FILE="$APP_DIR/app.pid"

if [ -f "$PID_FILE" ]; then
  pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    echo "running: $pid"
  else
    echo "pid file exists but process is not running"
  fi
else
  echo "not running"
fi

node "$APP_DIR/scripts/health-check.js"

