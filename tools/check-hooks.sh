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
# OD_HOOKS so that tools/check-hook-tests.mjs can point this at a copy
# with one promise broken and watch a case go red.
hooks=${OD_HOOKS:-$(pwd)/tools/hooks}
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

# Two renames at once, one of them through a name with a newline in it. Cut
# into lines, that name becomes two records and shifts every record after it:
# the shipped file's old path lands where a status is expected and is never
# read, so content.js could leave the package unnoticed in its company.
(cd "$lab" && git reset -q --hard && git clean -qfd)
echo "ordinary" > "$lab/a.txt"
(cd "$lab" && git add -- a.txt && git -c core.hooksPath=/dev/null commit -qm fourth)
(cd "$lab" && git mv a.txt "$(printf 'one\ntwo.txt')" && git mv content.js tools-backup.js)
try "a shipped file moved out beside a name with a newline in it" 1

# Cut into lines, a name with a newline in it also *invents* paths: half of
# one unshipped name read as a shipped file demands a version for nothing.
(cd "$lab" && git reset -q --hard && git clean -qfd)
printf 'x\n' > "$lab/$(printf 'notes\ncontent.js')"
try "a newline in an unshipped name does not invent a shipped one" 0

# --amend is not detected at all, on purpose: the only thing a hook can read
# about it is somebody else's command line, and a commit whose message said
# --amend was waved through. So a release being amended is refused like
# anything else, and the refusal says what to do about it.
(cd "$lab" && git reset -q --hard && git clean -qfd)
sed -i.bak 's/1\.2\.4/1.2.5/' "$lab/manifest.json" && rm -f "$lab/manifest.json.bak"
echo "e" >> "$lab/content.js"
(cd "$lab" && git add -- manifest.json content.js && git -c core.hooksPath="$hooks" commit -qm release)

echo "f" >> "$lab/content.js"
got=0
(cd "$lab" && git add -- content.js &&
 git -c core.hooksPath="$hooks" commit -q --amend --no-edit) >/dev/null 2>&1 || got=$?
expect "amending a release is still a shipped change without a version" 1

# And the way that exception used to be asked for: the rule read the parent
# process's command line, so saying the word was enough to be believed.
(cd "$lab" && git reset -q --hard && git clean -qfd)
echo "g" >> "$lab/content.js"
got=0
(cd "$lab" && git add -- content.js &&
 git -c core.hooksPath="$hooks" commit -q -m "Fix --amend detection") >/dev/null 2>&1 || got=$?
expect "a message that merely mentions --amend is not an amend" 1

if [ "$fails" != 0 ]; then exit 1; fi
echo "ok   version rule ($tries)"

# ---------------------------------------------------------------- privacy

# Made-up, all of it: a test for these hooks cannot be written against the
# real name and address without writing them down, which is the thing being
# prevented. The hooks ask $HOME and git for what to look for, so a throwaway
# home directory is all it takes to give them something else to find.
tries=0
fails=0
home=$lab/home/alice
dotted=$lab/home/j.doe
accented=$lab/home/élise
# A name git would escape rather than hand over as itself.
kana=$lab/home/さくらもち
repo=$lab/repo
mkdir -p "$home" "$dotted" "$accented" "$kana" "$repo"
use_home=$home

(
  cd "$repo"
  git init -q .
  git config user.email nobody@users.noreply.github.com
  git config user.name nobody
  # Long enough that a rename of it is recognised as one.
  seq 1 40 > seed.txt
  git add -- seed.txt
  git -c core.hooksPath=/dev/null commit -qm seed
)

fresh() { use_home=$home; (cd "$repo" && git reset -q --hard && git clean -qfd); }

# Nothing the hooks refuse may come back out in what they print: the terminal,
# the scrollback and the CI log are all places it would then exist.
quiet() {
  if grep -qi "alice\|j\.doe\|élise\|ÉLISE\|さくらもち\|private\.example\." "$lab/out"; then
    echo "FAIL $1 は拒否の理由として守っている文字列そのものを出しました"
    fails=$((fails + 1))
  fi
}

staged() {
  got=0
  (cd "$repo" && HOME="$use_home" "$hooks/pre-commit" >"$lab/out" 2>&1) || got=$?
  expect "$1" "$2"
  if [ "$2" = 1 ]; then quiet "$1"; fi
}

message() {
  printf '%s\n' "$2" > "$lab/msg"
  got=0
  (cd "$repo" && HOME="$use_home" "$hooks/commit-msg" "$lab/msg" >"$lab/out" 2>&1) || got=$?
  expect "$1" "$3"
  if [ "$3" = 1 ]; then quiet "$1"; fi
}

add() { (cd "$repo" && git add -- "$1"); }

# A fixture that quietly stops being what it says it is tests nothing. This
# one did: the rename case was an add and a delete, and passed against a hook
# that never looked at renames.
staged_is() {
  if ! (cd "$repo" && git diff --cached --name-status --diff-filter="$1" | grep -q "^$1"); then
    echo "FAIL $2 の仕掛けが $1 になっていません"
    fails=$((fails + 1))
  fi
}

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

# And one with a newline in it used to arrive as two real ones — these two,
# which are clean, so the hook read them and said nothing about the file that
# was actually being added.
fresh
printf 'nothing\n' > "$repo/one"
printf 'nothing\n' > "$repo/two.txt"
printf 'pilot@private.example.com\n' > "$repo/$(printf 'one\ntwo.txt')"
(cd "$repo" && git add -- one two.txt "$(printf 'one\ntwo.txt')")
staged "a filename with a newline does not hand the hook two other files" 1

# Filtered out by status, a file edited while being moved was read by nobody.
fresh
(cd "$repo" && git mv seed.txt moved.txt && printf 'pilot@private.example.com\n' >> moved.txt && git add -- moved.txt)
staged_is R "a rename carries its contents and is read too"
staged "a rename carries its contents and is read too" 1

# The name itself is a place something can sit, and then it cannot be what the
# refusal points at either.
fresh
printf 'nothing in here\n' > "$repo/pilot@private.example.invalid"
add "pilot@private.example.invalid"
staged "a filename that is itself an address is caught" 1

# Unanchored, the permitted suffix only had to appear somewhere.
fresh
printf 'pilot@users.noreply.github.com.private.example.com\n' > "$repo/notes.txt"
add notes.txt
staged "a lookalike of a permitted address is not one" 1

# A pattern spells the dot `\.`. Written that way — as the list of what to
# refuse, once — an address is still one.
fresh
printf '%s\n' "grep -q 'pilot@private\.example\.com'" > "$repo/notes.txt"
add notes.txt
staged "an address written as a pattern is still an address" 1

# A JavaScript string can escape the pattern's backslashes in turn.
fresh
printf '%s\n' '"pilot@private\\.example\\.com"' > "$repo/notes.txt"
add notes.txt
staged "an address inside an escaped pattern is still an address" 1
message "an escaped pattern in a message is still an address" '"pilot@private\\.example\\.com"' 1

fresh
printf 'nobody@users.noreply.github.com\n' > "$repo/notes.txt"
add notes.txt
staged "the permitted address itself goes through" 0

# What a commit takes away is already in the history; refusing to let it go
# would be exactly backwards — both the whole file, and the one line of a file
# that is being cleaned up.
fresh
printf 'pilot@private.example.com\n' > "$repo/leak.txt"
printf 'keep\npilot@private.example.com\n' > "$repo/history.txt"
(cd "$repo" && git add -- leak.txt history.txt)
(cd "$repo" && git -c core.hooksPath=/dev/null commit -qm "a leak, for the test")

(cd "$repo" && git rm -q leak.txt)
staged "taking a file like that back out is allowed" 0

fresh
printf 'keep\nnothing here now\n' > "$repo/history.txt"
add history.txt
staged "and so is taking the line out of one that stays" 0
(cd "$repo" && git add -- history.txt && git -c core.hooksPath=/dev/null commit -qm "cleaned")

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

# A name can hold a `.`, and as a pattern that matches any character at all.
fresh
use_home=$dotted
printf 'written by j.doe, probably\n' > "$repo/notes.txt"
add notes.txt
staged "a name with a dot in it is caught" 1

fresh
use_home=$dotted
printf 'jxdoe is somebody else entirely\n' > "$repo/notes.txt"
add notes.txt
staged "and the dot is a dot, not any letter" 0

fresh
use_home=$accented
printf 'written by ÉLISE, probably\n' > "$repo/notes.txt"
add notes.txt
staged "an accented account name is caught in another case" 1
message "an accented account name in a message is caught too" "ÉLISE looked at this" 1

fresh
printf 'cd %s/work\n' "$use_home" > "$repo/notes.txt"
add notes.txt
staged "the home directory path is caught" 1

# No file and no message shows this one; it rides on the commit itself.
# Author and committer are set apart, because one fixture answering for both
# cannot tell a hook that checks only one from a hook that checks both.
fresh
printf 'nothing to see\n' > "$repo/notes.txt"
add notes.txt
(cd "$repo" && git config user.email pilot@private.example.com)
staged "an identity nobody would publish is refused" 1
message "and refused on the way past the message as well" "A perfectly ordinary message" 1
(cd "$repo" && git config user.email nobody@users.noreply.github.com)

# The name it is made under is as published as the address beside it.
got=0
(cd "$repo" && GIT_AUTHOR_NAME=alice HOME="$home" "$hooks/pre-commit" >"$lab/out" 2>&1) || got=$?
expect "a commit made under the account name is refused" 1
quiet "a commit made under the account name is refused"

got=0
(cd "$repo" && GIT_AUTHOR_EMAIL=pilot@private.example.com HOME="$home" "$hooks/pre-commit" >"$lab/out" 2>&1) || got=$?
expect "an author nobody would publish is refused on its own" 1
quiet "an author nobody would publish is refused on its own"

got=0
(cd "$repo" && GIT_COMMITTER_EMAIL=pilot@private.example.com HOME="$home" "$hooks/pre-commit" >"$lab/out" 2>&1) || got=$?
expect "and so is a committer" 1
quiet "and so is a committer"

# An address at a host with no dot in it does not look like an address at all,
# which is why the identity is asked the other way round: not whether it looks
# private, but whether it is one of the two that are allowed.
got=0
(cd "$repo" && GIT_AUTHOR_EMAIL=pilot@intranet HOME="$home" "$hooks/pre-commit" >"$lab/out" 2>&1) || got=$?
expect "an identity at a host with no dot is refused too" 1

# The one file allowed to hold made-up versions of all this, and only that far:
# documentation domains yes, anything else no. (The refusal case cannot be
# written here — a non-reserved address in this file would stop this file
# being committed, which is the hook working.)
fresh
mkdir -p "$repo/tools"
printf 'pilot@private.example.com\n' > "$repo/tools/check-hooks.sh"
add tools/check-hooks.sh
staged "the file that must hold examples may hold them" 0

fresh
mkdir -p "$repo/tools"
printf 'cd %s/work\n' "$use_home" > "$repo/tools/check-hooks.sh"
add tools/check-hooks.sh
staged "but it is not exempt from anything else" 1

# An added line reading `++ something` arrives in the patch as `+++ something`,
# which is exactly what a file header looks like. Believed, it moved every
# line after it under a name of the commit's choosing — and one name has the
# documentation addresses allowed in it.
fresh
printf '++ b/tools/check-hooks.sh\npilot@private.example.com\n' > "$repo/notes.txt"
add notes.txt
staged "a line that looks like a file header is not one" 1

# A deleted line can supply the missing half of a fake header. Confirm the
# fixture is an actual adjacent ---/+++ pair inside a hunk, not two additions.
fresh
printf '%s\n' '-- a/x' > "$repo/notes.txt"
(cd "$repo" && git add -- notes.txt && git -c core.hooksPath=/dev/null commit -qm "header fixture")
printf '%s\n' '++ b/tools/channels.json' 'alice private note' 'pilot@private.example.com' > "$repo/notes.txt"
add notes.txt
if ! (cd "$repo" && git diff --cached -- notes.txt) | awk '
  previous == "--- a/x" && $0 == "+++ b/tools/channels.json" { found = 1 }
  { previous = $0 }
  END { exit !found }
'; then
  echo "FAIL the header forgery fixture is not an adjacent deletion/addition pair"
  fails=$((fails + 1))
fi
staged "a hunk cannot rename its additions to the skipped file" 1

fresh
printf '%s\n' '++ b/tools/check-hooks.sh' 'pilot@private.example.com' > "$repo/notes.txt"
add notes.txt
staged "a hunk cannot claim the documentation-address exemption" 1

fresh
printf '%s\n' '++ b/ordinary.txt' 'a harmless diff example' > "$repo/notes.txt"
add notes.txt
staged "a harmless header-looking hunk remains allowed" 0

# A rename that changes nothing has no content in the patch at all, so the
# name it landed under is the only thing there is to read.
fresh
(cd "$repo" && git mv seed.txt "pilot@private.example.invalid")
staged_is R "a rename that changes nothing still lands under a name"
staged "a rename that changes nothing still lands under a name" 1

# awk stops at a NUL, and --text hands it lines that have them.
fresh
printf 'x\000pilot@private.example.com\n' > "$repo/notes.txt"
add notes.txt
staged "a NUL does not hide what comes after it" 1

# Invalid bytes must not hide later content, regardless of whether this
# machine's text tools would stop at them. A failed reader is injected below.
utf8=$(locale -a 2>/dev/null | grep -m1 -iE '^(C|en_US)\.UTF-?8$' || true)
if [ -z "$utf8" ]; then
  echo "FAIL UTF-8 の locale がありません"
  fails=$((fails + 1))
fi

fresh
printf 'GIF89a\377\376\375\n' > "$repo/a.bin"
printf 'pilot@private.example.com\n' > "$repo/b.txt"
(cd "$repo" && git add -- a.bin b.txt)
got=0
(cd "$repo" && LC_ALL=$utf8 HOME="$use_home" "$hooks/pre-commit" >"$lab/out" 2>&1) || got=$?
expect "a binary file does not hide what comes after it" 1
quiet "a binary file does not hide what comes after it"

# Read to the end is also what lets the clean case through: refusing every
# commit that carries an image would be its own way of not working.
fresh
printf 'GIF89a\377\376\375\n' > "$repo/a.bin"
printf 'nothing\n' > "$repo/b.txt"
(cd "$repo" && git add -- a.bin b.txt)
got=0
(cd "$repo" && LC_ALL=$utf8 HOME="$use_home" "$hooks/pre-commit" >"$lab/out" 2>&1) || got=$?
expect "a binary file with nothing private in it goes through" 0

# A reader that stops halfway is injected, rather than assumed of the host.
# It stops only at the image's first odd byte; cutting the commit identity
# short as well would make the address check refuse for the wrong reason.
mkdir -p "$lab/bin"
real_perl=$(command -v perl)
cat > "$lab/bin/perl" <<EOF
#!/bin/sh
exec "$real_perl" -0777 -e '
  my \$text = <STDIN> // "";
  my \$at = index(\$text, "\377");
  if (\$at >= 0) { print substr(\$text, 0, \$at); exit 1; }
  print \$text;
'
EOF
chmod +x "$lab/bin/perl"
fresh
printf 'GIF89a\377\376\375\n' > "$repo/a.bin"
printf 'pilot@private.example.com\n' > "$repo/b.txt"
(cd "$repo" && git add -- a.bin b.txt)
got=0
(cd "$repo" && PATH="$lab/bin:$PATH" HOME="$use_home" "$hooks/pre-commit" >"$lab/out" 2>&1) || got=$?
expect "a scan that stops halfway is not a pass" 1
quiet "a scan that stops halfway is not a pass"

printf 'ordinary\377tail\n' > "$lab/msg"
got=0
(cd "$repo" && PATH="$lab/bin:$PATH" HOME="$use_home" "$hooks/commit-msg" "$lab/msg" >"$lab/out" 2>&1) || got=$?
expect "a message reader that stops halfway is not a pass" 1
quiet "a message reader that stops halfway is not a pass"

# The scanner saying nothing and git failing to say anything look identical
# from the far end of a pipe.
fresh
printf 'nothing\n' > "$repo/notes.txt"
add notes.txt
cp "$repo/.git/index" "$lab/index.kept"
printf 'not an index' > "$repo/.git/index"
staged "a git that cannot answer is not a pass" 1
cp "$lab/index.kept" "$repo/.git/index"

# A textconv driver is somebody's idea of how a file should read, and what is
# being committed is the bytes.
fresh
printf '*.txt diff=hider\n' > "$repo/.gitattributes"
(cd "$repo" && git config diff.hider.textconv "sed s/.*/clean/")
printf 'pilot@private.example.com\n' > "$repo/notes.txt"
(cd "$repo" && git add -- .gitattributes notes.txt)
staged "a textconv driver does not get to answer for the bytes" 1
(cd "$repo" && git config --unset diff.hider.textconv)

# diff.noprefix is an ordinary setting, and it takes two characters off the
# front of every path — which is a different path.
fresh
(cd "$repo" && git config diff.noprefix true)
mkdir -p "$repo/tools"
printf 'pilot@private.example.com\n' > "$repo/tools/check-hooks.sh"
add tools/check-hooks.sh
staged "the path is still the path with diff.noprefix set" 0
(cd "$repo" && git config --unset diff.noprefix)

# A name git escapes is a name the hook reads as escapes, and the thing it is
# looking for is not in them.
fresh
use_home=$kana
printf 'nothing in here\n' > "$repo/さくらもち.txt"
add "さくらもち.txt"
staged "a name git would rather escape is read as itself" 1

# Skipping by name is skipping that name.
fresh
mkdir -p "$repo/tools"
printf 'pilot@private.example.com\n' > "$repo/tools/channels.json"
add tools/channels.json
staged "the list of channels is left alone" 0

fresh
rm -f "$repo/tools/channels.json"
mkdir -p "$repo/tools/channels.json"
printf 'pilot@private.example.com\n' > "$repo/tools/channels.json/x.txt"
add tools/channels.json
staged "but not whatever else could sit under that name" 1
rm -rf "$repo/tools/channels.json"

# Built here rather than written down: a real-looking address *in this file*
# would stop this file being committed, which is the hook working.
fresh
mkdir -p "$repo/tools"
printf 'pilot@mail.%s\n' "corp" > "$repo/tools/check-hooks.sh"
add tools/check-hooks.sh
staged "and a real-looking address is not allowed even there" 1

# A merge that resolves itself never reaches pre-commit; git runs a different
# hook, and for a while nothing read what the merge brought in.
fresh
here=$(cd "$repo" && git rev-parse --abbrev-ref HEAD)
(cd "$repo" && git checkout -q -b side)
printf 'pilot@private.example.com\n' > "$repo/merged.txt"
(cd "$repo" && git add -- merged.txt && git -c core.hooksPath=/dev/null commit -qm "from the side")
(cd "$repo" && git checkout -q "$here")
got=0
(cd "$repo" && HOME="$home" git -c core.hooksPath="$hooks" merge -q --no-ff side) >"$lab/out" 2>&1 || got=$?
expect "a merge that resolves itself is read too" 1
quiet "a merge that resolves itself is read too"
(cd "$repo" && git merge --abort >/dev/null 2>&1; git branch -qD side >/dev/null 2>&1) || true

fresh
message "an address in the message is refused" "ask pilot@private.example.com" 1
message "the account name in the message is refused" "alice looked at this" 1
message "a header-looking message line checks its full content" "++ ALICE" 1
message "a word that contains it is not" "Clarify malice handling" 0
message "an ordinary message goes through" "A hook that names nothing it is protecting" 0

# Plain messages are decoded before being marked as added lines too.
printf 'caf\351 pilot@private.example.com\n' > "$lab/msg"
got=0
(cd "$repo" && LC_ALL=$utf8 HOME="$use_home" "$hooks/commit-msg" "$lab/msg" >"$lab/out" 2>&1) || got=$?
expect "a byte that is not UTF-8 does not hide the message" 1
quiet "a byte that is not UTF-8 does not hide the message"

printf 'ordinary\377tail\n' > "$lab/msg"
got=0
(cd "$repo" && LC_ALL=$utf8 HOME="$use_home" "$hooks/commit-msg" "$lab/msg" >"$lab/out" 2>&1) || got=$?
expect "a message with a bad byte and nothing private goes through" 0

# A verified public stage name can coincide with the account name. Only an
# exact line in its approved path may skip that one check. Copy the active
# hooks (including any mutation) so fixtures never change the real table.
original_hooks=$hooks
cp -R "$hooks" "$lab/public-hooks"
hooks=$lab/public-hooks
public_name='alice Example is a public stage name'
approve_line() {
  digest=$(printf '%s' "$2" | perl -MDigest::SHA=sha256_hex -0777 -ne 'print sha256_hex($_)')
  printf '%s\t%s\n' "$1" "$digest" >> "$hooks/public-names.tsv"
}
approve_line public.txt "$public_name"

fresh
printf 'ordinary content\n' > "$repo/aaa.txt"
printf '%s\n' "$public_name" > "$repo/public.txt"
(cd "$repo" && git add -- aaa.txt public.txt)
staged "a verified public name passes only as its exact line" 0

printf 'alice private note\n' >> "$repo/public.txt"
add public.txt
staged "another account-name line in an approved file is refused" 1

fresh
printf '%s\n' "$public_name" > "$repo/other.txt"
add other.txt
staged "a public name allowance does not follow the line to another file" 1

fresh
printf '%s\n' '++ b/public.txt' "$public_name" > "$repo/notes.txt"
add notes.txt
staged "a hunk cannot borrow an approved name from another path" 1

fresh
printf 'alice\000Example is a public stage name\n' > "$repo/public.txt"
add public.txt
staged "a NUL cannot turn a changed line into an approved line" 1

fresh
with_address="$public_name pilot@private.example.com"
approve_line public.txt "$with_address"
printf '%s\n' "$with_address" > "$repo/public.txt"
add public.txt
staged "an approved name line still checks addresses" 1

fresh
with_home="$public_name $use_home/work"
approve_line public.txt "$with_home"
printf '%s\n' "$with_home" > "$repo/public.txt"
add public.txt
staged "an approved name line still checks home paths" 1

fresh
approve_line alice-public.txt "$public_name"
printf '%s\n' "$public_name" > "$repo/alice-public.txt"
add alice-public.txt
staged "an approved content line never exempts its filename" 1

fresh
digest=$(printf '%s' "$public_name" | perl -MDigest::SHA=sha256_hex -0777 -ne 'print sha256_hex($_)')
# Put private content on the SAME line as the forged marker, in an approved
# path. An unanchored marker recogniser would skip this entire added line.
printf 'pilot@private.example.com alice od-name-hash:%s\n' "$digest" > "$repo/public.txt"
add public.txt
staged "file content cannot forge a reader hash" 1

message "public name allowances do not apply to commit messages" "$public_name" 1

fresh
printf 'ordinary content\n' > "$repo/notes.txt"
add notes.txt
cp "$hooks/public-names.tsv" "$lab/public-names.kept"
printf 'invalid table row\n' >> "$hooks/public-names.tsv"
staged "a malformed public name table is refused" 1
rm "$hooks/public-names.tsv"
staged "a missing public name table is refused" 1
cp "$lab/public-names.kept" "$hooks/public-names.tsv"
hooks=$original_hooks

if [ "$fails" != 0 ]; then exit 1; fi
echo "ok   privacy rule ($tries)"
