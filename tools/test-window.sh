#!/bin/sh
# Opens a separate test browser with the Read Aloud 2 add-on loaded from ./extension, for checks by hand or over the
# DevTools protocol (port 9333). It never touches the owner's own Chrome: it starts a test browser binary directly,
# with its own profile folder, and it stops only the process that it started itself (its PID is in a file).
#   tools/test-window.sh [url]   start the test browser (a test browser that this script started before is stopped first)
#   tools/test-window.sh stop    stop the test browser that this script started
# The test browser: the file in RA2_TEST_CHROME, else the newest Chrome for Testing (or Chromium) that Puppeteer or
# Playwright installed in their cache folders. The owner's Chrome in /Applications is never used.
# The profile folder: RA2_TEST_PROFILE, else a folder in the temporary folder of this user ($TMPDIR, or
# ~/.cache/read-aloud-2-test-window when TMPDIR is not set). No pkill, killall, open -a or osascript.
set -u

DIR="$(cd "$(dirname "$0")/.." && pwd)"
if [ -n "${TMPDIR:-}" ]; then STATE="${TMPDIR%/}/read-aloud-2-test-window"; else STATE="$HOME/.cache/read-aloud-2-test-window"; fi
PROFILE="${RA2_TEST_PROFILE:-$STATE/profile}"
PIDFILE="$STATE/browser.pid"
LOG="$STATE/browser.log"
PORT=9333
URL="${1:-https://en.wikipedia.org/wiki/Root_canal_treatment}"

fail() { echo "test-window: $*" >&2; exit 1; }

# The true path of a file, with every symbolic link resolved.
real() {
  if command -v realpath >/dev/null 2>&1; then realpath "$1" 2>/dev/null && return 0; fi
  command -v python3 >/dev/null 2>&1 && python3 -c 'import os,sys;print(os.path.realpath(sys.argv[1]))' "$1" 2>/dev/null
}

# A folder of this script (state or profile) must not be a symbolic link, and must belong to this user when it is there.
own_folder() {
  [ -L "$1" ] && fail "'$1' is a symbolic link. The script uses only a real folder of its own."
  if [ -e "$1" ] && [ ! -O "$1" ]; then fail "'$1' does not belong to this user."; fi
  return 0
}

# True when the command line of PID still names the test profile folder (a PID can be given to another program later).
is_ours() {
  ps -p "$1" -o command= 2>/dev/null | grep -F -- "--user-data-dir=$PROFILE" >/dev/null
}

# Something listens on the port: lsof, else nc. With neither, the port cannot be checked: stop.
port_busy() {
  if command -v lsof >/dev/null 2>&1; then lsof -tiTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; return $?; fi
  if command -v nc >/dev/null 2>&1; then nc -z 127.0.0.1 "$1" >/dev/null 2>&1; return $?; fi
  fail "cannot check port $1: neither lsof nor nc is installed."
}

# The PID in the PID file, when that process still runs with this profile folder. Else nothing.
running_pid() {
  [ -f "$PIDFILE" ] || return 1
  pid="$(cat "$PIDFILE" 2>/dev/null)"
  case "$pid" in ''|*[!0-9]*) return 1 ;; esac
  kill -0 "$pid" 2>/dev/null || return 1
  # A PID can be used again by another program: stop it only when its command line names this profile folder.
  is_ours "$pid" || return 1
  echo "$pid"
}

stop_browser() {
  if ! pid="$(running_pid)"; then
    rm -f "$PIDFILE"
    echo "test-window: no test browser of this script runs."
    return 0
  fi
  # Check the command line again just before the kill: the process may have ended, and the PID may be another's now.
  is_ours "$pid" || { rm -f "$PIDFILE"; echo "test-window: PID $pid is no longer the test browser; nothing stopped."; return 0; }
  kill "$pid" 2>/dev/null
  n=0
  while kill -0 "$pid" 2>/dev/null && [ "$n" -lt 50 ]; do sleep 0.1; n=$((n + 1)); done
  if kill -0 "$pid" 2>/dev/null; then fail "the test browser (PID $pid) did not stop in 5 seconds. Stop it with: kill $pid"; fi
  rm -f "$PIDFILE"
  echo "test-window: the test browser (PID $pid) is stopped."
}

# The newest file that matches one of the patterns (the shell expands them), or nothing.
newest() {
  # The paths have spaces ("Google Chrome for Testing"): split only at a new line, and let the shell expand the *.
  OLDIFS="$IFS"
  IFS='
'
  for pattern in "$@"; do
    # shellcheck disable=SC2086  # the pattern must be expanded here
    for f in $pattern; do [ -f "$f" ] && [ -x "$f" ] && echo "$f"; done
  done | sort -V | tail -n 1
  IFS="$OLDIFS"
}

find_browser() {
  if [ -n "${RA2_TEST_CHROME:-}" ]; then
    [ -x "$RA2_TEST_CHROME" ] || fail "RA2_TEST_CHROME is set, but '$RA2_TEST_CHROME' is not a program that can run."
    echo "$RA2_TEST_CHROME"
    return 0
  fi
  P="$HOME/.cache/puppeteer/chrome"
  W="$HOME/Library/Caches/ms-playwright"
  T="Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
  found="$(newest \
    "$P/mac_arm-*/chrome-mac-arm64/$T" "$P/mac-*/chrome-mac-x64/$T" "$P/linux-*/chrome-linux64/chrome")"
  [ -n "$found" ] || found="$(newest \
    "$W/chromium-*/chrome-mac-arm64/$T" "$W/chromium-*/chrome-mac-x64/$T" "$W/chromium-*/chrome-mac/Chromium.app/Contents/MacOS/Chromium" \
    "$HOME/.cache/ms-playwright/chromium-*/chrome-linux*/chrome")"
  [ -n "$found" ] || fail "no test browser found. Install Chrome for Testing (for example: npx @puppeteer/browsers install chrome@stable, in a folder of your choice), or set RA2_TEST_CHROME to the program file of a test browser. The own Chrome is never used."
  echo "$found"
}

if [ "${1:-}" = "stop" ]; then stop_browser; exit $?; fi

# Refuse the owner's Chrome: by its path, by its true path (symbolic links resolved), and by the bundle id of the app
# that holds the program (com.google.Chrome and its channels; Chrome for Testing is com.google.chrome.for.testing).
own_chrome() {
  case "$1" in
    "/Applications/Google Chrome"*.app/*|"$HOME/Applications/Google Chrome"*.app/*) return 0 ;;
  esac
  case "$1" in
    *.app/*)
      plist="${1%%.app/*}.app/Contents/Info.plist"
      if [ -f "$plist" ] && [ -x /usr/libexec/PlistBuddy ]; then
        id="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$plist" 2>/dev/null)"
        case "$id" in com.google.Chrome|com.google.Chrome.*) return 0 ;; esac
      fi ;;
  esac
  return 1
}

BIN="$(find_browser)" || exit 1
REAL="$(real "$BIN")" || fail "cannot resolve the true path of '$BIN' (no realpath and no python3)."
[ -n "$REAL" ] || fail "cannot resolve the true path of '$BIN'."
if own_chrome "$BIN" || own_chrome "$REAL"; then fail "'$BIN' is the own Chrome. Use a test browser."; fi
case "$PROFILE" in
  ''|/|"$HOME"|"$HOME/"|"$HOME/Library/Application Support/Google/Chrome"*) fail "the profile folder '$PROFILE' is not a test profile folder." ;;
esac
own_folder "$STATE"
own_folder "$PROFILE"

stop_browser >/dev/null || exit 1
if port_busy "$PORT"; then
  fail "another program listens on port $PORT. Stop it first; this script stops only the test browser that it started."
fi

mkdir -p "$STATE" "$PROFILE" || fail "cannot make the profile folder '$PROFILE'."
own_folder "$STATE"
own_folder "$PROFILE"
[ -L "$PROFILE/Default" ] && fail "'$PROFILE/Default' is a symbolic link."
[ -L "$PIDFILE" ] && fail "the PID file '$PIDFILE' is a symbolic link."
# The browser keeps an old copy of the add-on's background script between starts: clear that copy (in this profile only).
rm -rf "$PROFILE/Default/Service Worker"

nohup "$REAL" \
  --user-data-dir="$PROFILE" \
  --remote-debugging-port="$PORT" \
  --use-mock-keychain --password-store=basic \
  --no-first-run --no-default-browser-check \
  --load-extension="$DIR/extension" \
  "$URL" >"$LOG" 2>&1 &
pid=$!
echo "$pid" >"$PIDFILE"
sleep 1
kill -0 "$pid" 2>/dev/null || { rm -f "$PIDFILE"; fail "the test browser stopped at once. See $LOG"; }
echo "test-window: test browser started (PID $pid, DevTools port $PORT, profile $PROFILE)."
echo "test-window: stop it with: tools/test-window.sh stop"
