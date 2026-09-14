#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/home/clovisstar/apps/clovisstar-static-rebuild"
STAMP="sumerian-video-page-20260704-174500"
ARCHIVE="$APP_DIR/${STAMP}.tgz"
BACKUP_DIR="$APP_DIR/backups/$STAMP"

cd "$APP_DIR"

test -f "$ARCHIVE"

mkdir -p "$BACKUP_DIR/data/books" "$BACKUP_DIR/assets/js"

cp data/books-index.json "$BACKUP_DIR/"
cp data/site-statistics.json "$BACKUP_DIR/"
cp data/site-version.json "$BACKUP_DIR/"
cp data/review-queue.json "$BACKUP_DIR/"
cp data/cleanup-report.json "$BACKUP_DIR/"
cp package.json "$BACKUP_DIR/"
cp package-lock.json "$BACKUP_DIR/"
cp assets/js/app.js "$BACKUP_DIR/assets/js/"

if [ -f data/books/sumerian-creation-story-enki-enlil-anunna-great-flood.json ]; then
  cp data/books/sumerian-creation-story-enki-enlil-anunna-great-flood.json "$BACKUP_DIR/data/books/"
fi

tar -xzf "$ARCHIVE"

if [ -x ./scripts/stop-production.sh ]; then
  ./scripts/stop-production.sh || true
fi

if [ -x ./scripts/start-production.sh ]; then
  ./scripts/start-production.sh
fi

npm run health
npm run audit:content:check

echo "DEPLOYED $STAMP"

