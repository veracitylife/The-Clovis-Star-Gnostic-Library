#!/usr/bin/env sh
set -eu

APP_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
BIN_DIR="$HOME/bin"
mkdir -p "$BIN_DIR" "$APP_DIR/logs"

cat > "$BIN_DIR/clovisstar-db-maintain.sh" <<EOF
#!/usr/bin/env sh
cd "$APP_DIR"
npm run db:maintain >> "$APP_DIR/logs/db-maintain.log" 2>&1
EOF

cat > "$BIN_DIR/clovisstar-db-optimize.sh" <<EOF
#!/usr/bin/env sh
cd "$APP_DIR"
npm run db:optimize >> "$APP_DIR/logs/db-optimize.log" 2>&1
EOF

cat > "$BIN_DIR/clovisstar-regression-smoke.sh" <<EOF
#!/usr/bin/env sh
cd "$APP_DIR"
npm run smoke:live >> "$APP_DIR/logs/regression-smoke.log" 2>&1
EOF

cat > "$BIN_DIR/clovisstar-health-monitor.sh" <<EOF
#!/usr/bin/env sh
cd "$APP_DIR"
npm run monitor:health >> "$APP_DIR/logs/health-monitor.log" 2>&1
EOF

cat > "$BIN_DIR/clovisstar-screenshot-qa.sh" <<EOF
#!/usr/bin/env sh
cd "$APP_DIR"
npm run qa:screenshots >> "$APP_DIR/logs/screenshot-qa.log" 2>&1
EOF

cat > "$BIN_DIR/clovisstar-log-maintenance.sh" <<EOF
#!/usr/bin/env sh
cd "$APP_DIR"
npm run logs:maintain >> "$APP_DIR/logs/log-maintenance.log" 2>&1
EOF

chmod +x "$BIN_DIR/clovisstar-db-maintain.sh" "$BIN_DIR/clovisstar-db-optimize.sh" "$BIN_DIR/clovisstar-regression-smoke.sh" "$BIN_DIR/clovisstar-health-monitor.sh" "$BIN_DIR/clovisstar-screenshot-qa.sh" "$BIN_DIR/clovisstar-log-maintenance.sh"

tmp="$(mktemp)"
crontab -l 2>/dev/null | grep -v 'clovisstar-.*# clovisstar-static-' > "$tmp" || true
cat >> "$tmp" <<EOF
17 2 * * * $BIN_DIR/clovisstar-db-maintain.sh # clovisstar-static-db-maintain
43 3 * * 0 $BIN_DIR/clovisstar-db-optimize.sh # clovisstar-static-db-optimize
21 */6 * * * $BIN_DIR/clovisstar-regression-smoke.sh # clovisstar-static-smoke
*/15 * * * * $BIN_DIR/clovisstar-health-monitor.sh # clovisstar-static-health-monitor
58 4 * * * $BIN_DIR/clovisstar-screenshot-qa.sh # clovisstar-static-screenshot-qa
37 1 * * * $BIN_DIR/clovisstar-log-maintenance.sh # clovisstar-static-log-maintenance
EOF
crontab "$tmp"
rm -f "$tmp"
crontab -l | grep 'clovisstar-static-'

