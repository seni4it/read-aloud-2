#!/bin/sh
# Builds store/read-aloud-2-<version>.zip: the add-on folder as the Chrome Web Store wants it.
DIR="$(cd "$(dirname "$0")/.." && pwd)"
V=$(python3 -c "import json;print(json.load(open('$DIR/extension/manifest.json'))['version'])")
OUT="$DIR/store/read-aloud-2-$V.zip"
rm -f "$OUT"; cd "$DIR/extension" && zip -qr "$OUT" . -x '*.DS_Store' && echo "$OUT"
