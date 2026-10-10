#!/bin/sh
# The hooks only run if git has been told where they are, and that setting
# lives in .git/config — which is not cloned. So a fresh clone has them in
# the tree and switched off, which is the worst of both.
set -e
cd "$(dirname "$0")/.."

want=tools/hooks
have=$(git config core.hooksPath || true)

if [ "$have" != "$want" ]; then
  echo "FAIL hooks が有効になっていません。一度だけ:"
  echo "       git config core.hooksPath $want"
  exit 1
fi
echo "ok   hooks ($want)"

# Installed is not working. The version rule went in because fourteen commits
# had already gone out under one version number, so a rule that does not
# actually fire would be the same mistake with a file in front of it.
hook=$(pwd)/tools/hooks/pre-commit
lab=$(mktemp -d)
trap 'rm -rf "$lab"' EXIT

(
  cd "$lab"
  git init -q .
  git config user.email nobody@users.noreply.github.com
  git config user.name nobody
  printf '{\n  "version": "1.2.3"\n}\n' > manifest.json
  echo "a" > content.js
  echo "b" > tools-ish.txt
  git add . >/dev/null
  git -c core.hooksPath=/dev/null commit -qm first
)

tries=0
fails=0
try() {
  tries=$((tries + 1))
  # `set -e` is on, and a bare failing command would take the file down
  # before the comparison that is the whole point of the test.
  got=0
  (cd "$lab" && git add -A >/dev/null && "$hook" >/dev/null 2>&1) || got=$?
  if [ "$got" != "$2" ]; then
    echo "FAIL $1"
    fails=$((fails + 1))
  fi
}

echo "c" >> "$lab/content.js"
try "a shipped file changed under the same version is refused" 1

sed -i.bak 's/1\.2\.3/1.2.4/' "$lab/manifest.json" && rm -f "$lab/manifest.json.bak"
try "and goes through once the version moves" 0

(cd "$lab" && git add -A >/dev/null && git -c core.hooksPath=/dev/null commit -qm second)
echo "d" >> "$lab/tools-ish.txt"
try "something that is not shipped needs no version at all" 0

if [ "$fails" != 0 ]; then exit 1; fi
echo "ok   version rule ($tries)"
