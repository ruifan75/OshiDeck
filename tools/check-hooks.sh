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
# actually fire would be the same mistake with a file in front of it. The
# privacy hooks had been taken on trust the same way for longer, and four
# ways through them turned up the first time anybody ran them.
hooks=$(pwd)/tools/hooks
lab=$(mktemp -d)
trap 'rm -rf "$lab"' EXIT

tries=0
fails=0
expect() {
  tries=$((tries + 1))
  if [ "$got" != "$2" ]; then
    echo "FAIL $1 (exit $got, want $2)"
    fails=$((fails + 1))
  fi
}

# ---------------------------------------------------------------- version

(
  cd "$lab"
  git init -q .
  git config user.email nobody@users.noreply.github.com
  git config user.name nobody
  printf '{\n  "version": "1.2.3"\n}\n' > manifest.json
  echo "a" > content.js
  echo "b" > tools-ish.txt
  git add -- manifest.json content.js tools-ish.txt
  git -c core.hooksPath=/dev/null commit -qm first
)

try() {
  # `set -e` is on, and a bare failing command would take the file down
  # before the comparison that is the whole point of the test.
  got=0
  (cd "$lab" && git add -- . >/dev/null && "$hooks/pre-commit" >/dev/null 2>&1) || got=$?
  expect "$1" "$2"
}

echo "c" >> "$lab/content.js"
try "a shipped file changed under the same version is refused" 1

sed -i.bak 's/1\.2\.3/1.2.4/' "$lab/manifest.json" && rm -f "$lab/manifest.json.bak"
try "and goes through once the version moves" 0

(cd "$lab" && git add -- . >/dev/null && git -c core.hooksPath=/dev/null commit -qm second)
echo "d" >> "$lab/tools-ish.txt"
try "something that is not shipped needs no version at all" 0

# A shipped file can leave the package as well as change inside it, and a
# rename names only where it landed.
(cd "$lab" && git add -- . >/dev/null && git -c core.hooksPath=/dev/null commit -qm third)
(cd "$lab" && git mv content.js tools-backup.js)
try "a shipped file moved out of the package still needs a version" 1

# --amend replaces HEAD, so the version it has to beat is the one before
# HEAD. Measured against HEAD itself, a release being amended looks like a
# commit that never moved the version — when moving it is what it did. This
# one has to be a real amend: the hook works it out from how git was called.
(cd "$lab" && git reset -q --hard && git clean -qfd)
sed -i.bak 's/1\.2\.4/1.2.5/' "$lab/manifest.json" && rm -f "$lab/manifest.json.bak"
echo "e" >> "$lab/content.js"
(cd "$lab" && git add -- manifest.json content.js && git -c core.hooksPath="$hooks" commit -qm release)

echo "f" >> "$lab/content.js"
got=0
(cd "$lab" && git add -- content.js &&
 git -c core.hooksPath="$hooks" commit -q --amend --no-edit) >/dev/null 2>&1 || got=$?
expect "amending a release that already moved the version is allowed" 0

# And not a way round the rule: amend into a commit that did not move it and
# the answer is the same as it would be for an ordinary commit.
echo "g" >> "$lab/tools-ish.txt"
(cd "$lab" && git add -- tools-ish.txt && git -c core.hooksPath="$hooks" commit -qm notes)
echo "h" >> "$lab/content.js"
got=0
(cd "$lab" && git add -- content.js &&
 git -c core.hooksPath="$hooks" commit -q --amend --no-edit) >/dev/null 2>&1 || got=$?
expect "but amending a shipped change into one that did not is refused" 1

if [ "$fails" != 0 ]; then exit 1; fi
echo "ok   version rule ($tries)"

# ---------------------------------------------------------------- privacy

# Made-up, both of them: a test for these hooks cannot be written against the
# real name and address without writing them down, which is the thing being
# prevented. The hooks ask $HOME and git for what to look for, so a throwaway
# home directory is all it takes to give them something else to find.
tries=0
fails=0
home=$lab/home/alice
repo=$lab/repo
mkdir -p "$home" "$repo"

(
  cd "$repo"
  git init -q .
  git config user.email nobody@users.noreply.github.com
  git config user.name nobody
  echo "seed" > seed.txt
  git add -- seed.txt
  git -c core.hooksPath=/dev/null commit -qm seed
)

fresh() { (cd "$repo" && git reset -q --hard && git clean -qfd); }

# Nothing the hooks refuse may come back out in what they print: the terminal,
# the scrollback and the CI log are all places it would then exist.
quiet() {
  if grep -qi "alice\|private\.example\.com" "$lab/out"; then
    echo "FAIL $1 は拒否の理由として守っている文字列そのものを出しました"
    fails=$((fails + 1))
  fi
}

staged() {
  got=0
  (cd "$repo" && HOME="$home" "$hooks/pre-commit" >"$lab/out" 2>&1) || got=$?
  expect "$1" "$2"
  if [ "$2" = 1 ]; then quiet "$1"; fi
}

message() {
  printf '%s\n' "$2" > "$lab/msg"
  got=0
  (cd "$repo" && HOME="$home" "$hooks/commit-msg" "$lab/msg" >"$lab/out" 2>&1) || got=$?
  expect "$1" "$3"
  if [ "$3" = 1 ]; then quiet "$1"; fi
}

add() { (cd "$repo" && git add -- "$1"); }

# An allowed address does not make the line it is on a safe place to stand.
fresh
printf 'ask pilot@private.example.com or nobody@users.noreply.github.com\n' > "$repo/notes.txt"
add notes.txt
staged "an address beside a permitted one is still an address" 1

# A name with a space in it used to arrive as two names, neither of which
# existed, so the file was never opened.
fresh
printf 'pilot@private.example.com\n' > "$repo/a note.txt"
add "a note.txt"
staged "a filename with a space does not hide what is in it" 1

# Filtered out by status, a file edited while being moved was read by nobody.
fresh
(cd "$repo" && git mv seed.txt moved.txt && printf 'pilot@private.example.com\n' >> moved.txt && git add -- moved.txt)
staged "a rename carries its contents and is read too" 1

# Unanchored, the permitted suffix only had to appear somewhere.
fresh
printf 'pilot@users.noreply.github.com.private.example.com\n' > "$repo/notes.txt"
add notes.txt
staged "a lookalike of a permitted address is not one" 1

fresh
printf 'nobody@users.noreply.github.com\n' > "$repo/notes.txt"
add notes.txt
staged "the permitted address itself goes through" 0

fresh
printf 'written by alice, probably\n' > "$repo/notes.txt"
add notes.txt
staged "the account name is caught" 1

# Bounded on the left, open on the right: still that person with a number
# after it, nobody at all with a letter before it.
fresh
printf 'see alice75 for the rest\n' > "$repo/notes.txt"
add notes.txt
staged "and so is the account name with something stuck to it" 1

fresh
printf 'Clarify malice handling\n' > "$repo/notes.txt"
add notes.txt
staged "a longer word that merely contains it is not a mention" 0

fresh
printf 'cd %s/work\n' "$home" > "$repo/notes.txt"
add notes.txt
staged "the home directory path is caught" 1

# No file and no message shows this one; it rides on the commit itself.
fresh
(cd "$repo" && git config user.email alice@private.example.com)
printf 'nothing to see\n' > "$repo/notes.txt"
add notes.txt
staged "an identity nobody would publish is refused too" 1
message "and refused on the way past the message as well" "A perfectly ordinary message" 1
(cd "$repo" && git config user.email nobody@users.noreply.github.com)

fresh
message "an address in the message is refused" "ask pilot@private.example.com" 1
message "the account name in the message is refused" "alice looked at this" 1
message "a word that contains it is not" "Clarify malice handling" 0
message "an ordinary message goes through" "A hook that names nothing it is protecting" 0

if [ "$fails" != 0 ]; then exit 1; fi
echo "ok   privacy rule ($tries)"
