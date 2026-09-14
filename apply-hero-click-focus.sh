set -euo pipefail
APP=/home/clovisstar/apps/clovisstar-static-rebuild
PUB=/home/clovisstar/public_html
BUNDLE=$APP/hero-click-focus.tgz
STAMP=$(date +%Y%m%d%H%M%S)
BACKUP=/home/clovisstar/backups/clovisstar-static/hero-click-focus-$STAMP
mkdir -p "$BACKUP/app/assets/js" "$BACKUP/public/assets/js"
for f in index.html assets/js/app.js; do
  if [ -e "$APP/$f" ]; then cp -a "$APP/$f" "$BACKUP/app/$f"; fi
  if [ -e "$PUB/$f" ]; then cp -a "$PUB/$f" "$BACKUP/public/$f"; fi
done
tar -xzf "$BUNDLE" -C "$APP"
tar -xzf "$BUNDLE" -C "$PUB"
systemctl --user restart clovisstar-static.service
sleep 2
systemctl --user is-active clovisstar-static.service
echo "backup=$BACKUP"
