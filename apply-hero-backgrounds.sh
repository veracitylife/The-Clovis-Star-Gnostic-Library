set -euo pipefail
APP=/home/clovisstar/apps/clovisstar-static-rebuild
PUB=/home/clovisstar/public_html
BUNDLE=$APP/hero-backgrounds-favicon-blink.tgz
STAMP=$(date +%Y%m%d%H%M%S)
BACKUP=/home/clovisstar/backups/clovisstar-static/hero-backgrounds-$STAMP
mkdir -p "$BACKUP/app" "$BACKUP/public"
files=(
  index.html
  assets/css/styles.css
  assets/js/app.js
  server.js
  favicon.ico
  favicon-32.png
  favicon-64.png
  apple-touch-icon.png
  site.webmanifest
  assets/audio/sumerian-star.mp3
  assets/img/hero-pyramid-open.png
  assets/img/hero-pyramid-closed.png
  assets/img/hero-bg-ur-01.jpg
  assets/img/hero-bg-ur-02.jpg
  assets/img/hero-bg-ur-03.jpg
  assets/img/hero-bg-ur-04.jpg
  assets/img/hero-bg-ur-05.jpg
  assets/img/hero-bg-ur-06.jpg
)
for f in "${files[@]}"; do
  if [ -e "$APP/$f" ]; then mkdir -p "$BACKUP/app/$(dirname "$f")"; cp -a "$APP/$f" "$BACKUP/app/$f"; fi
  if [ -e "$PUB/$f" ]; then mkdir -p "$BACKUP/public/$(dirname "$f")"; cp -a "$PUB/$f" "$BACKUP/public/$f"; fi
done
if [ -e "$PUB/server.js" ]; then mkdir -p "$BACKUP/public"; cp -a "$PUB/server.js" "$BACKUP/public/server.js"; rm -f "$PUB/server.js"; fi
tar -xzf "$BUNDLE" -C "$APP"
tar --exclude='server.js' -xzf "$BUNDLE" -C "$PUB"
systemctl --user restart clovisstar-static.service
sleep 2
systemctl --user is-active clovisstar-static.service
echo "backup=$BACKUP"
