#!/bin/sh
# Run every automatic test of Read Aloud 2 and give one result.
#   ./run-tests.sh
# 1. The voice server tests (Python standard library, no voice model).
# 2. The browser logic tests (Node built-in test runner): every tests/node/*.test.mjs.
# Exit code 0 when all pass, 1 when any fails. No package is installed; no network is used.
# The PDF text comparison with its difference is a separate step: node tests/pdf-text/compare.mjs
cd "$(dirname "$0")" || exit 1

PYTHON="${PYTHON:-$HOME/.local/share/uv/tools/mlx-audio/bin/python}"
[ -x "$PYTHON" ] || PYTHON=python3
NODE="${NODE:-/opt/homebrew/bin/node}"
[ -x "$NODE" ] || NODE=node

status=0

echo "== Python tests (voice server)"
if "$PYTHON" -m unittest discover -s tests -v; then py=PASS; else py=FAIL; status=1; fi

echo
echo "== Node tests (browser logic)"
if "$NODE" --test --test-timeout=120000 tests/node/*.test.mjs; then js=PASS; else js=FAIL; status=1; fi

echo
echo "Python tests: $py"
echo "Node tests:   $js"
if [ "$status" -eq 0 ]; then echo "RESULT: PASS"; else echo "RESULT: FAIL"; fi
exit "$status"
