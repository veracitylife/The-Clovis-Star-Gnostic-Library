#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/home/clovisstar/apps/clovisstar-static-rebuild"
PUBLIC_DIR="/home/clovisstar/public_html"
STAMP="gilgamesh-video-page-20260704-224000"
ARCHIVE="$APP_DIR/${STAMP}.tgz"
BACKUP_DIR="$APP_DIR/backups/$STAMP"

cd "$APP_DIR"
test -f "$ARCHIVE"

mkdir -p "$BACKUP_DIR/data/books" "$BACKUP_DIR/assets/js" "$BACKUP_DIR/public/assets/js"

cp data/books-index.json "$BACKUP_DIR/data/"
cp data/site-statistics.json "$BACKUP_DIR/data/"
cp data/site-version.json "$BACKUP_DIR/data/"
cp data/review-queue.json "$BACKUP_DIR/data/"
cp data/cleanup-report.json "$BACKUP_DIR/data/"
cp assets/js/app.js "$BACKUP_DIR/assets/js/"
cp package.json "$BACKUP_DIR/"
cp package-lock.json "$BACKUP_DIR/"

if [ -f data/books/sumerian-epic-of-gilgamesh-video-study.json ]; then
  cp data/books/sumerian-epic-of-gilgamesh-video-study.json "$BACKUP_DIR/data/books/"
fi

if [ -f "$PUBLIC_DIR/assets/js/app.js" ]; then
  cp "$PUBLIC_DIR/assets/js/app.js" "$BACKUP_DIR/public/assets/js/"
fi

tar -xzf "$ARCHIVE"

if [ -d "$PUBLIC_DIR/assets/js" ]; then
  cp "$APP_DIR/assets/js/app.js" "$PUBLIC_DIR/assets/js/app.js"
fi

if [ -x ./scripts/stop-production.sh ]; then
  ./scripts/stop-production.sh || true
fi

if [ -x ./scripts/start-production.sh ]; then
  ./scripts/start-production.sh
fi

npm run health
npm run audit:content:check
echo "DEPLOYED $STAMP"

