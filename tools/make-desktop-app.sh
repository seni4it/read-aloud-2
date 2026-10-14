#!/bin/sh
# Builds "Read Aloud.app" in ~/Applications: the desktop PDF reader with a library.
# It starts the voice server (voice-server.py) when needed and opens the library in its own window.
set -e
DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP="$HOME/Applications/Read Aloud.app"
PY="$HOME/.local/share/uv/tools/mlx-audio/bin/python"
rm -rf "$APP"; mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
# icon: the add-on's orange play disc, drawn at every size macOS wants
TMP=$(mktemp -d); mkdir "$TMP/icon.iconset"
python3 - "$TMP/icon.iconset" <<'PY'
import struct, sys, zlib
def png(n, path):
    c = (n - 1) / 2; rows = []
    for y in range(n):
        row = b'\x00'
        for x in range(n):
            inside = (x - c) ** 2 + (y - c) ** 2 <= (n / 2 - 0.5) ** 2
            tx, ty = (x - n * 0.36) / (n * 0.36), (y - c) / (n * 0.27)
            tri = 0 <= tx <= 1 and abs(ty) <= 1 - tx
            row += bytes((0, 0, 0, 0)) if not inside else bytes((16, 35, 63, 255)) if tri else bytes((255, 140, 0, 255))
        rows.append(row)
    ch = lambda t, d: struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    open(path, 'wb').write(b'\x89PNG\r\n\x1a\n' + ch(b'IHDR', struct.pack('>IIBBBBB', n, n, 8, 6, 0, 0, 0)) + ch(b'IDAT', zlib.compress(b''.join(rows), 9)) + ch(b'IEND', b''))
for s in (16, 32, 128, 256, 512):
    png(s, f'{sys.argv[1]}/icon_{s}x{s}.png'); png(s * 2, f'{sys.argv[1]}/icon_{s}x{s}@2x.png')
PY
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
echo "$APP"
