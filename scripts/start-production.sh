#!/usr/bin/env sh
set -eu

APP_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
PID_FILE="$APP_DIR/app.pid"
LOG_FILE="$APP_DIR/app.log"

cd "$APP_DIR"

if [ -f "$PID_FILE" ]; then
  old_pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [ -n "$old_pid" ] && kill -0 "$old_pid" 2>/dev/null; then
    echo "already running: $old_pid"
    exit 0
  fi
fi

NODE_ENV="${NODE_ENV:-production}" HOST="${HOST:-127.0.0.1}" PORT="${PORT:-4173}" nohup npm run serve > "$LOG_FILE" 2>&1 &
echo "$!" > "$PID_FILE"
echo "started: $(cat "$PID_FILE")"

