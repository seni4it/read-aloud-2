#!/bin/sh
# Starts the Read Aloud voice server at login and keeps it running (a LaunchAgent for this user only).
#   tools/autostart.sh          turn on
#   tools/autostart.sh off      turn off (removes the LaunchAgent)
DIR="$(cd "$(dirname "$0")/.." && pwd)"
LABEL=com.semion.read-aloud-2
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
PY="$HOME/.local/share/uv/tools/mlx-audio/bin/python"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null
if [ "$1" = "off" ]; then rm -f "$PLIST"; echo "Auto-start is off."; exit 0; fi
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$PY</string><string>$DIR/voice-server.py</string><string>8793</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Interactive</string>
  <key>StandardOutPath</key><string>$HOME/Library/Logs/read-aloud-server.log</string>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/read-aloud-server.log</string>
</dict></plist>
PLIST
lsof -tiTCP:8793 -sTCP:LISTEN | xargs kill 2>/dev/null; sleep 1   # a server started by hand gives way to the login one
launchctl bootstrap "gui/$(id -u)" "$PLIST" && echo "Auto-start is on: the voice server starts at login."
