#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/home/clovisstar/apps/clovisstar-static-rebuild"
STAMP="youtube-embed-20260704-202000"
ARCHIVE="$APP_DIR/${STAMP}.tgz"
BACKUP_DIR="$APP_DIR/backups/$STAMP"

cd "$APP_DIR"
test -f "$ARCHIVE"

mkdir -p "$BACKUP_DIR/data/books" "$BACKUP_DIR/assets/js" "$BACKUP_DIR/assets/css" "$BACKUP_DIR/books" "$BACKUP_DIR/members" "$BACKUP_DIR/admin"
cp data/books/sumerian-creation-story-enki-enlil-anunna-great-flood.json "$BACKUP_DIR/data/books/"
cp data/books-index.json "$BACKUP_DIR/data/"
cp data/site-version.json "$BACKUP_DIR/data/"
cp assets/js/app.js "$BACKUP_DIR/assets/js/"
cp assets/css/styles.css "$BACKUP_DIR/assets/css/"
cp server.js "$BACKUP_DIR/"
cp package.json "$BACKUP_DIR/"
cp package-lock.json "$BACKUP_DIR/"
cp books/index.html "$BACKUP_DIR/books/"
cp members/index.html "$BACKUP_DIR/members/"
cp admin/index.html "$BACKUP_DIR/admin/"

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

