#!/bin/sh
# Opens (or reopens) the test Chrome window with the Read Aloud 2 add-on loaded from ./extension.
# Chrome keeps an old copy of the add-on's background script between starts, so that copy is cleared first.
DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP="$HOME/Library/Caches/ms-playwright/chromium-1247/chrome-mac-arm64/Google Chrome for Testing.app"
pkill -f "user-data-dir=$DIR/.test-profile" 2>/dev/null; sleep 1
rm -rf "$DIR/.test-profile/Default/Service Worker"
open -na "$APP" --args --user-data-dir="$DIR/.test-profile" --load-extension="$DIR/extension" \
  --no-first-run --no-default-browser-check --remote-debugging-port=9333 "${1:-https://en.wikipedia.org/wiki/Root_canal_treatment}"
