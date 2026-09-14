#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/home/clovisstar/apps/clovisstar-static-rebuild"
PUBLIC_DIR="/home/clovisstar/public_html"
STAMP="youtube-embed-public-20260704-202000"
BACKUP_DIR="$APP_DIR/backups/$STAMP"

mkdir -p "$BACKUP_DIR/books" "$BACKUP_DIR/members" "$BACKUP_DIR/admin" "$BACKUP_DIR/assets/js" "$BACKUP_DIR/assets/css"

cp "$PUBLIC_DIR/books/index.html" "$BACKUP_DIR/books/"
cp "$PUBLIC_DIR/members/index.html" "$BACKUP_DIR/members/"
cp "$PUBLIC_DIR/admin/index.html" "$BACKUP_DIR/admin/"
cp "$PUBLIC_DIR/assets/js/app.js" "$BACKUP_DIR/assets/js/"
cp "$PUBLIC_DIR/assets/css/styles.css" "$BACKUP_DIR/assets/css/"

cp "$APP_DIR/books/index.html" "$PUBLIC_DIR/books/index.html"
cp "$APP_DIR/members/index.html" "$PUBLIC_DIR/members/index.html"
cp "$APP_DIR/admin/index.html" "$PUBLIC_DIR/admin/index.html"
cp "$APP_DIR/assets/js/app.js" "$PUBLIC_DIR/assets/js/app.js"
cp "$APP_DIR/assets/css/styles.css" "$PUBLIC_DIR/assets/css/styles.css"

echo "DEPLOYED $STAMP"

