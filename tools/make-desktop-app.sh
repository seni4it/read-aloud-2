#!/bin/sh
# Builds "Read Aloud.app" in ~/Applications: the desktop PDF reader with a library.
# It starts the voice server (voice-server.py) when needed and opens the library in its own window.
set -e
DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP="${1:-/Applications}/Read Aloud.app"  # the main Applications folder; another folder can be given
PY="$HOME/.local/share/uv/tools/mlx-audio/bin/python"
rm -rf "$APP"; mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
# icon: app/icon/icon-1024.png (drawn from app/icon/icon.html) at every size macOS wants
TMP=$(mktemp -d); mkdir "$TMP/icon.iconset"
for s in 16 32 128 256 512; do
  sips -z $s $s "$DIR/app/icon/icon-1024.png" --out "$TMP/icon.iconset/icon_${s}x${s}.png" >/dev/null
  sips -z $((s*2)) $((s*2)) "$DIR/app/icon/icon-1024.png" --out "$TMP/icon.iconset/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$TMP/icon.iconset" -o "$APP/Contents/Resources/icon.icns"; rm -rf "$TMP"
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>Read Aloud</string>
  <key>CFBundleDisplayName</key><string>Read Aloud</string>
  <key>CFBundleIdentifier</key><string>com.semion.read-aloud-2</string>
  <key>CFBundleExecutable</key><string>read-aloud</string>
  <key>CFBundleIconFile</key><string>icon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>2.4</string>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
</dict></plist>
PLIST
cat > "$APP/Contents/MacOS/read-aloud" <<SH
#!/bin/sh
# Start the voice server if it is not running, then open the library in its own window.
if ! curl -s -m 1 -o /dev/null http://127.0.0.1:8793/voices; then
  nohup "$PY" "$DIR/voice-server.py" 8793 > "\$HOME/Library/Logs/read-aloud-server.log" 2>&1 &
  for i in \$(seq 1 60); do curl -s -m 1 -o /dev/null http://127.0.0.1:8793/voices && break; sleep 0.5; done
fi
open -na "Google Chrome" --args --app=http://127.0.0.1:8793/app/ \\
  --user-data-dir="\$HOME/Library/Application Support/Read Aloud 2 App" --no-first-run --no-default-browser-check
SH
chmod +x "$APP/Contents/MacOS/read-aloud"
touch "$APP"
ln -sfn "$APP" "$HOME/Desktop/Read Aloud"   # a shortcut on the Desktop
# in the Dock, once
if ! defaults read com.apple.dock persistent-apps 2>/dev/null | grep -q "Read%20Aloud.app"; then
  defaults write com.apple.dock persistent-apps -array-add "<dict><key>tile-data</key><dict><key>file-data</key><dict><key>_CFURLString</key><string>file://$(echo "$APP" | sed 's/ /%20/g')/</string><key>_CFURLStringType</key><integer>15</integer></dict></dict></dict>"
  killall Dock
fi
echo "$APP"
