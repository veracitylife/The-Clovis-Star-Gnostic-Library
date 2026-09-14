#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
printf 'App path: %s\n' "$(pwd)"
if [ -f app.pid ]; then printf 'PID: '; cat app.pid; else echo 'PID: not found'; fi
if [ -f app.log ]; then tail -20 app.log; else echo 'app.log not found'; fi
printf '\nHealth: '; curl -fsS http://127.0.0.1:4173/api/auth/me 2>/dev/null || true; printf '\n'
printf 'Compare bytes: '; curl -fsS http://127.0.0.1:4173/compare/ | wc -c

