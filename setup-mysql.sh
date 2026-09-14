#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
read -rsp "Enter Clovis Star app database password: " CLOVIS_DB_PASSWORD
printf '\n'
export CLOVIS_STORAGE=mysql
export CLOVIS_DB_HOST=clovisstar.com
export CLOVIS_DB_NAME=clovisstar_script101ab
export CLOVIS_DB_USER=clovisstar_92scripts101
export CLOVIS_DB_PASSWORD
npm install --omit=dev
npm run db:init
if [ -f app.pid ] && kill -0 "$(cat app.pid)" 2>/dev/null; then
  kill "$(cat app.pid)" || true
fi
nohup env PORT=4173 CLOVIS_STORAGE=mysql CLOVIS_DB_HOST="$CLOVIS_DB_HOST" CLOVIS_DB_NAME="$CLOVIS_DB_NAME" CLOVIS_DB_USER="$CLOVIS_DB_USER" CLOVIS_DB_PASSWORD="$CLOVIS_DB_PASSWORD" node server.js > app.log 2>&1 &
echo $! > app.pid
sleep 2
tail -20 app.log

