#!/usr/bin/env sh
set -eu

APP_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
SYSTEMD_DIR="$HOME/.config/systemd/user"
mkdir -p "$SYSTEMD_DIR" "$APP_DIR/logs"
cp "$APP_DIR/scripts/clovisstar-static.service" "$SYSTEMD_DIR/clovisstar-static.service"
systemctl --user daemon-reload
systemctl --user enable clovisstar-static.service
systemctl --user restart clovisstar-static.service
systemctl --user status clovisstar-static.service --no-pager | sed -n '1,20p'

