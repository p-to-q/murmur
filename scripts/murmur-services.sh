#!/usr/bin/env bash
# murmur-services.sh — install Murmur workers for login auto-start.
#
# Repos under ~/Desktop or ~/Documents cannot be read by launchd (macOS TCC).
# Those installs use a Login Item app bundle instead; other paths use LaunchAgent.
#
#   bash scripts/murmur-services.sh install
#   bash scripts/murmur-services.sh status
#   bash scripts/murmur-services.sh restart
#   bash scripts/murmur-services.sh logs
#   bash scripts/murmur-services.sh stop
#   bash scripts/murmur-services.sh uninstall
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SUPERVISOR="$ROOT/scripts/murmur-supervisor.sh"
LOG_DIR="$HOME/Library/Logs/murmur"
SUPPORT_DIR="$HOME/Library/Application Support/io.ptoq.murmur"
APP_INSTALL="/Applications/MurmurWorkers.app"
LAUNCH_AGENTS="$HOME/Library/LaunchAgents"
LABEL="io.ptoq.murmur-workers"
PLIST="$LAUNCH_AGENTS/${LABEL}.plist"

needs_login_item() {
  case "$ROOT" in
    *"/Desktop/"*|*"/Documents/"*) return 0 ;;
    *) return 1 ;;
  esac
}

preflight() {
  local missing=0
  for bin in cloudflared vercel curl openssl; do
    if ! command -v "$bin" >/dev/null 2>&1; then
      echo "✗ missing dependency: $bin" >&2
      missing=1
    fi
  done
  for venv in "$ROOT/workers/audio-engine/.venv" "$ROOT/workers/music-engine/.venv"; do
    if [ ! -x "$venv/bin/uvicorn" ]; then
      echo "✗ missing venv: $venv — run: bun run setup:audio && bun run setup:music" >&2
      missing=1
    fi
  done
  [ "$missing" -eq 0 ] || exit 1
}

write_plist() {
  mkdir -p "$LOG_DIR" "$LAUNCH_AGENTS"
  cat >"$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${SUPERVISOR}</string>
    <string>run</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${ROOT}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:${HOME}/.bun/bin:/usr/local/bin:/usr/bin:/bin</string>
    <key>MAGENTA_MODEL</key>
    <string>mrt2_base</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${LOG_DIR}/launchagent.out.log</string>
  <key>StandardErrorPath</key>
  <string>${LOG_DIR}/launchagent.err.log</string>
  <key>ThrottleInterval</key>
  <integer>30</integer>
</dict>
</plist>
EOF
}

write_app_bundle() {
  mkdir -p "$SUPPORT_DIR/MurmurWorkers.app/Contents/MacOS"
  cat >"$SUPPORT_DIR/MurmurWorkers.app/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>launcher</string>
  <key>CFBundleIdentifier</key>
  <string>io.ptoq.murmur-workers</string>
  <key>CFBundleName</key>
  <string>MurmurWorkers</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0</string>
  <key>LSBackgroundOnly</key>
  <true/>
  <key>LSUIElement</key>
  <true/>
</dict>
</plist>
EOF
  cat >"$SUPPORT_DIR/MurmurWorkers.app/Contents/MacOS/launcher" <<EOF
#!/bin/bash
export PATH="/opt/homebrew/bin:${HOME}/.bun/bin:/usr/local/bin:/usr/bin:/bin"
export MAGENTA_MODEL="\${MAGENTA_MODEL:-mrt2_base}"
ROOT="${ROOT}"
PIDFILE="${LOG_DIR}/supervisor.pid"
if [ -f "\$PIDFILE" ]; then
  old=\$(cat "\$PIDFILE" 2>/dev/null || true)
  if [ -n "\$old" ] && kill -0 "\$old" 2>/dev/null; then exit 0; fi
fi
exec /bin/bash "\$ROOT/scripts/murmur-supervisor.sh" run
EOF
  chmod +x "$SUPPORT_DIR/MurmurWorkers.app/Contents/MacOS/launcher"
  rm -rf "$APP_INSTALL"
  cp -R "$SUPPORT_DIR/MurmurWorkers.app" "$APP_INSTALL"
}

write_open_plist() {
  mkdir -p "$LOG_DIR" "$LAUNCH_AGENTS"
  cat >"$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/open</string>
    <string>-gj</string>
    <string>${APP_INSTALL}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>StartInterval</key>
  <integer>180</integer>
  <key>StandardOutPath</key>
  <string>${LOG_DIR}/launchagent.out.log</string>
  <key>StandardErrorPath</key>
  <string>${LOG_DIR}/launchagent.err.log</string>
</dict>
</plist>
EOF
}

agent_bootout() {
  launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true
}

agent_bootstrap() {
  launchctl bootstrap "gui/$(id -u)" "$PLIST"
  launchctl enable "gui/$(id -u)/${LABEL}" 2>/dev/null || true
  launchctl kickstart -k "gui/$(id -u)/${LABEL}" 2>/dev/null || true
}

login_item_add() {
  osascript <<APPLESCRIPT 2>/dev/null || return 1
tell application "System Events"
  set appPath to POSIX file "${APP_INSTALL}"
  repeat with li in login items
    if path of li is appPath then return
  end repeat
  make login item at end with properties {path:appPath, hidden:true}
end tell
APPLESCRIPT
}

login_item_present() {
  osascript <<APPLESCRIPT 2>/dev/null
tell application "System Events"
  set appPath to POSIX file "${APP_INSTALL}"
  repeat with li in login items
    if path of li is appPath then return "yes"
  end repeat
  return "no"
end tell
APPLESCRIPT
}

login_item_remove() {
  osascript <<APPLESCRIPT 2>/dev/null || true
tell application "System Events"
  set appPath to POSIX file "${APP_INSTALL}"
  repeat with li in login items
    if path of li is appPath then delete li
  end repeat
end tell
APPLESCRIPT
}

ensure_supervisor_running() {
  if [ -f "$LOG_DIR/supervisor.pid" ] && kill -0 "$(cat "$LOG_DIR/supervisor.pid" 2>/dev/null)" 2>/dev/null; then
    return 0
  fi
  bash "$SUPERVISOR" start
}

install_launchagent() {
  login_item_remove
  write_plist
  agent_bootout
  agent_bootstrap
  echo "✓ Installed LaunchAgent (${LABEL})"
}

install_login_item() {
  write_app_bundle
  write_open_plist
  agent_bootout
  agent_bootstrap
  if login_item_add; then
    echo "✓ Login Item registered: ${APP_INSTALL}"
  else
    echo "⚠ Could not auto-add Login Item — add manually:"
    echo "  System Settings → General → Login Items → + → ${APP_INSTALL}"
  fi
  echo "✓ LaunchAgent uses open -gj (Desktop-safe, re-checks every 3 min)"
}

install() {
  preflight
  mkdir -p "$LOG_DIR" "$SUPPORT_DIR"
  if needs_login_item; then
    install_login_item
  else
    install_launchagent
  fi
  ensure_supervisor_running
  echo "  • Starts automatically on login; supervisor self-heals workers + tunnels"
  echo "  • Logs: ${LOG_DIR}/"
  echo "  • Status: bash scripts/murmur-services.sh status"
  echo ""
  echo "Tip: disable sleep on power adapter (System Settings → Energy) while serving prod."
  sleep 5
  bash "$SUPERVISOR" status || true
}

uninstall() {
  agent_bootout
  login_item_remove
  bash "$SUPERVISOR" stop 2>/dev/null || true
  rm -f "$PLIST"
  rm -rf "$SUPPORT_DIR/MurmurWorkers.app" "$APP_INSTALL"
  echo "✓ Murmur auto-start removed and supervisor stopped"
}

stop() {
  agent_bootout
  bash "$SUPERVISOR" stop 2>/dev/null || true
  pkill -f 'cloudflared tunnel --url http://127.0.0.1:800[12]' 2>/dev/null || true
  echo "✓ Murmur workers stopped"
}

restart() {
  stop
  sleep 2
  install
}

status() {
  if needs_login_item; then
    echo "mode: Desktop-safe (repo under TCC-protected path)"
    if [ "$(login_item_present 2>/dev/null || echo no)" = "yes" ]; then
      echo "login item: ${APP_INSTALL}"
    else
      echo "login item: not registered — add in System Settings → Login Items"
    fi
    if launchctl print "gui/$(id -u)/${LABEL}" >/dev/null 2>&1; then
      echo "launchagent: LOADED (open -gj watcher, every 3 min)"
    else
      echo "launchagent: not loaded — run install"
    fi
  elif launchctl print "gui/$(id -u)/${LABEL}" >/dev/null 2>&1; then
    echo "launchagent: LOADED (${LABEL})"
    launchctl print "gui/$(id -u)/${LABEL}" 2>/dev/null | grep -E 'state =|pid =|last exit' || true
  elif [ -f "$PLIST" ]; then
    echo "launchagent: plist present but not loaded — run install"
  else
    echo "launchagent: not installed"
  fi
  echo ""
  bash "$SUPERVISOR" status
}

logs() {
  tail -n 50 -F \
    "$LOG_DIR/supervisor.log" \
    "$LOG_DIR/audio-engine.log" \
    "$LOG_DIR/music-engine.log" \
    "$LOG_DIR/tunnel-audio.log" \
    "$LOG_DIR/tunnel-music.log" \
    "$LOG_DIR/launchagent.out.log" \
    "$LOG_DIR/launchagent.err.log" 2>/dev/null
}

case "${1:-}" in
  install) install ;;
  uninstall) uninstall ;;
  stop) stop ;;
  restart) restart ;;
  status) status ;;
  logs) logs ;;
  *) echo "usage: $0 {install|uninstall|stop|restart|status|logs}" >&2; exit 1 ;;
esac
