# 29. Test window script: safe start and stop

GitHub issue: none yet
Status: code done, checked without a browser; real start open (see Work report)
Type: AFK

## Parent

`.scratch/robust-reader/spec.md`

## What to build

`tools/test-window.sh` opens a test browser with the Add-on loaded. Today it uses `pkill` and `open -na`, and it names a Chromium (`chromium-1247`) that is not installed. That is not safe: `open -na` and a wide `pkill` can touch the owner's own Chrome.

Rewrite the script:

- It finds a test browser: the variable `RA2_TEST_CHROME` first, then Chrome for Testing in `~/.cache/puppeteer` or other usual places. When it finds none, it stops with a clear message. It never uses the owner's own Chrome or its default profile.
- It starts the program directly, with its own `--user-data-dir` (a temporary folder), `--remote-debugging-port=9333`, `--use-mock-keychain`, `--no-first-run` and `--load-extension=<repo>/extension`.
- It writes the PID to a file. `stop` stops only that PID.
- No `pkill`, `killall`, `open -a` or `osascript`.

Update `docs/testing.md` where it tells about this script. Correct the README line that names the LaunchAgent, if it is wrong.

## Acceptance criteria

- [x] The script finds the test browser in the given order, and stops with a clear message when there is none.
- [x] It starts the program directly with its own profile folder and the given switches.
- [x] It writes the PID to a file; `stop` stops only that PID.
- [x] No `pkill`, `killall`, `open -a` or `osascript`.
- [x] `docs/testing.md` and the README tell about the new script.
- [x] The README line of the LaunchAgent is checked.
- [ ] A real start with Chrome for Testing (see Work report).

## Blocked by

None - can start immediately

## Work report

Date: 10 Nov 2026. No browser was started in this work, and nothing on the ports 8791 and 8793 was touched. No git command that changes the repository was run.

### What changed

`tools/test-window.sh` is new from the top (POSIX sh, `set -u`).

- Search for the test browser (`find_browser`, line 62): first `RA2_TEST_CHROME` (it must be a program that can run, or the script stops). Then the newest Chrome for Testing of Puppeteer (`~/.cache/puppeteer/chrome/mac_arm-*`, `mac-*`, `linux-*`). Then the newest Chrome for Testing or Chromium of Playwright (`~/Library/Caches/ms-playwright/chromium-*`, and `~/.cache/ms-playwright` on Linux). "Newest" is the last by `sort -V`. With none, the script stops with a message that tells how to get one. The paths have spaces, so `newest()` (line 50) splits the patterns only at a new line.
- Guards: a program in `/Applications/Google Chrome.app` or `~/Applications/Google Chrome.app` is refused, also from `RA2_TEST_CHROME`. A profile folder that is empty, `/`, the home folder, or the folder of the own Chrome profile is refused.
- Profile folder: `$TMPDIR/read-aloud-2-test-window/profile`, or `RA2_TEST_PROFILE`. The old `.test-profile/` in the project folder is not used now. A folder in `.scratch/` was not used, because git keeps `.scratch/` (only `.scratch/answers/` is ignored). The PID file and the browser log are in `$TMPDIR/read-aloud-2-test-window/`.
- Start (line 99): `nohup "<program>" --user-data-dir=<profile> --remote-debugging-port=9333 --use-mock-keychain --password-store=basic --no-first-run --no-default-browser-check --load-extension=<repo>/extension <url>`, in the background. `--password-store=basic` is from the Chrome check of 10 Nov, where it kept the keychain question away. The PID goes to the file. When the program stops within 1 second, the script says so and names the log.
- Before a start, the script clears the old copy of the background script of the Add-on (`Default/Service Worker`) in its own profile folder only, as the old script did.
- A start first stops the test browser that the script started before (only that PID). When another program listens on port 9333, the script stops with a message and changes nothing (`lsof`, read only).
- `stop` (`stop_browser`, line 35): it reads the PID file. It stops the process only when the process runs and its command line has `--user-data-dir=<the test profile>` (`running_pid`, line 25). So a PID that the system gave to another program is never stopped. It sends `kill <pid>` (TERM), waits up to 5 seconds, and removes the PID file. When the process does not stop, it says so and gives the command.
- The default address is the same as before.

`docs/testing.md`: the section "Audio cache size" is now "Sound memory size" (ticket 28), and a new section "Test window" tells how to start and stop, where the browser comes from, the profile, and why the script cannot touch the own Chrome.

`README.md`, section "Test window": now names the test browser, `RA2_TEST_CHROME`, `stop`, and `docs/testing.md`.

LaunchAgent line of the README: not wrong, not changed. `tools/autostart.sh` sets `LABEL=com.semion.read-aloud-2` and writes `PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"`. So the file is `~/Library/LaunchAgents/com.semion.read-aloud-2.plist`, as the README says. The README names the file, not the label.

### Checks

- `bash -n`, `sh -n` and `dash -n`: no error. `shellcheck` is not installed here, so it did not run.
- A search for `pkill`, `killall`, `open -a`, `open -na` and `osascript` finds them only in the comment that says the script does not use them.
- A run with a fake browser (a small shell script that only waits), with `HOME` and `TMPDIR` in a scratch folder, so no real browser and no real profile were used:
  - `stop` with nothing running: message, exit 0.
  - `RA2_TEST_CHROME=/nope`: clear message, exit 1.
  - No browser in the folders: clear message, exit 1.
  - Two fake Playwright versions (1234 and 1248): 1248 started, with all the switches above, and the PID file was written.
  - A second start stopped the first fake (only its PID) and started a new one.
  - `stop` stopped only that PID and removed the PID file.
  - `RA2_TEST_CHROME` set to a fake: that fake started, not the Playwright one.
  - A PID file with the PID of another running process: `stop` did not touch that process.
  - `RA2_TEST_CHROME` set to the own Chrome in `/Applications`: refused, exit 1.

### What a real start must confirm

On this Mac, Playwright has `chromium-1234` and `chromium-1248`; check which folders have `chrome-mac-arm64/Google Chrome for Testing.app` (older Playwright versions have `chrome-mac/Chromium.app`, which the script also finds).

1. `tools/test-window.sh about:blank`: a separate window opens; the own Chrome stays as it was (its windows and tabs).
2. No keychain question comes.
3. The Add-on is loaded (chrome://extensions in the test window), from `extension/` of the working tree.
4. `curl -s http://127.0.0.1:9333/json/version` answers.
5. `tools/test-window.sh stop` closes only the test window; the own Chrome stays open.

### Open points

- `.gitignore` still names `.test-profile/`. The new script does not use it; the line does no harm. An old `.test-profile/` folder in the project folder can be moved to the Trash by the owner.

### Review repairs

Review of 10 Nov 2026: no bug, but risks. No real browser was started; each repair was checked with a fake browser (a small shell script that waits), with `HOME` and `TMPDIR` in a scratch folder.

1. **Guard against the own Chrome.** The script now resolves the true path of the program (`realpath`, else `python3 os.path.realpath`; when neither works it stops). It refuses the program when its path or its true path is in `/Applications/Google Chrome*.app` or `~/Applications/Google Chrome*.app` (this also covers Beta, Dev and Canary). It also reads the bundle id of the app that holds the program (`/usr/libexec/PlistBuddy`, `Contents/Info.plist`) and refuses `com.google.Chrome` and `com.google.Chrome.*`. Chrome for Testing has `com.google.chrome.for.testing` (read on this Mac from the Playwright copy 1248), so it is accepted. The script starts the true path. Checked: a symbolic link to the own Chrome is refused; a fake app with the bundle id `com.google.Chrome` in another folder is refused; a fake app with the Chrome for Testing id starts and stops.
2. **Port check.** `port_busy()` uses `lsof`, else `nc -z 127.0.0.1 9333`. With neither, the script stops: "cannot check port 9333: neither lsof nor nc is installed." Checked with a PATH that has no `lsof` and no `nc`. `--remote-debugging-address=127.0.0.1` was not added. In Chrome this switch counts only for headless mode, and a browser with a window listens for DevTools on 127.0.0.1 by default. This could not be confirmed here, because no browser and no network were used. The real start must confirm it (step 4 below, and `lsof -iTCP:9333 -sTCP:LISTEN` shows `localhost:9333` or `127.0.0.1:9333`, not `*:9333`).
3. **State folder and links.** When `TMPDIR` is not set, the state folder is `~/.cache/read-aloud-2-test-window` (not `/tmp`). Before `mkdir` and again before the `rm -rf` of the old background script copy, the script refuses a state or profile folder that is a symbolic link or does not belong to this user (`own_folder`). It also refuses a `Default` folder or a PID file that is a symbolic link. Checked: `TMPDIR` not set (the folder is made under the home folder, start and stop work); a state folder that is a link and a profile folder that is a link are refused, exit 1.
4. **Check before the kill.** `stop_browser` checks the command line of the PID again just before `kill` (`is_ours`). When it is no longer the test browser, the script says so, removes the PID file and stops nothing. Checked: a PID file with the PID of another running process leaves that process running.

Checks: `bash -n`, `sh -n` and `dash -n` pass. `shellcheck` is not installed. Files: `tools/test-window.sh`, `docs/testing.md` (guards, `TMPDIR` fallback, port check).
