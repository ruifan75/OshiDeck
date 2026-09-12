#!/bin/sh
# Everything that can be checked without a browser: syntax, undefined calls,
# and the pure logic in src/ driven against a fake chrome.storage.
set -e
cd "$(dirname "$0")/.."

echo "syntax"
for f in content.js options.js src/*.js tools/*.mjs; do node --check "$f"; done
node --check tools/tests/*.js
printf '  ok\n\n'

echo "undefined calls"
node tools/check-refs.mjs content.js options.js background.js src/*.js tools/check-refs.mjs
echo

echo "css traps"
node tools/check-css.mjs content.css options.css
node tools/check-var-timing.mjs content.css options.css
echo

echo "logic"
fail=0
for t in tools/tests/*.js tools/tests/*.mjs; do
  name=$(basename "$t")
  if node "$t" >/dev/null 2>&1; then
    echo "  ok   $name"
  else
    echo "  FAIL $name"
    fail=1
  fi
done
echo

# Green has to mean something: break each guarantee in turn and require the
# channel tests to notice. Three of them once did not.
echo "tests that can fail"
node tools/check-tests.mjs || fail=1

exit $fail
