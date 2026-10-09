#!/bin/sh
# Every active channel in an organisation, one after another.
#
#   tools/mine-org.sh ReAcT
#   tools/mine-org.sh Hololive 15
#   tools/mine-org.sh --subscriptions      # the maintainer's own list, in his order
#
# Hours, not minutes — so it is resumable: a channel that already has a
# candidates file is skipped, and stopping it anywhere loses at most the one
# in progress. Run it again and it carries on.
#
# Chat is deleted as soon as it has been counted. Fifteen streams is about
# 90MB and there are 157 channels between ReAcT and Hololive; keeping it all
# would be 14GB of files that one command can fetch again.
#
# Mining the whole organisation is also what makes the scopes decidable.
# Whether a phrase belongs to a channel or to everybody cannot be answered
# from inside one chat — 🦢✨ is 稀羽すう's own sign and ordinary emoji at the
# same time — and the answer is simply whether the rooms next door say it
# too. See tools/scope.mjs.
set -e
cd "$(dirname "$0")/.."

org=$1
want=${2:-15}

if [ -z "$org" ]; then
  echo "usage: tools/mine-org.sh <org> [streams]"
  echo "       tools/mine-org.sh --subscriptions [streams]"
  echo "       node tools/channels.mjs --orgs   # で名前を確かめられます"
  exit 1
fi

mkdir -p tools/candidates

# `--subscriptions` keeps the order it is given, which is the order the maintainer
# arranged his own subscriptions in — a better answer to "which channel next"
# than subscriber counts. Inside an organisation there is no such order, so
# the biggest rooms go first: they are the ones with chat to count.
ids=$(node -e '
  const fs = require("node:fs");
  const org = process.argv[1];

  let want;
  if (org === "--subscriptions") {
    // Not in the repository: who somebody follows, and in what order, is
    // theirs. tools/subscriptions.mjs writes it from a saved page.
    if (!fs.existsSync("tools/subscriptions.json")) {
      console.error("FAIL tools/subscriptions.json がありません。");
      console.error("     youtube.com/feed/channels を保存して、");
      console.error("     node tools/subscriptions.mjs <保存したページ> を回してください");
      process.exit(1);
    }
    // Already in his order; keep it.
    want = JSON.parse(fs.readFileSync("tools/subscriptions.json", "utf8"))
      .filter((c) => !c.inactive);
  } else {
    want = JSON.parse(fs.readFileSync("tools/channels.json", "utf8"))
      .filter((c) => c.org === org && !c.inactive)
      .sort((a, b) => b.subscribers - a.subscribers);
    if (!want.length) {
      console.error(`FAIL ${org} のチャンネルが tools/channels.json にありません`);
      process.exit(1);
    }
  }
  for (const c of want) console.log(c.id);
' -- "$org")

total=$(echo "$ids" | wc -l | tr -d ' ')
at=0
done_already=0

for ch in $ids; do
  at=$((at + 1))

  if [ -f "tools/candidates/${ch}.json" ]; then
    done_already=$((done_already + 1))
    continue
  fi

  printf '[%s/%s] %s ' "$at" "$total" "$ch"

  streams=$(node tools/channels.mjs --streams "$ch" --limit "$want" 2>/dev/null || true)
  if [ -z "$streams" ]; then
    echo "— 配信なし"
    continue
  fi

  work="chat/${ch}"
  mkdir -p "$work"
  got=0
  for v in $streams; do
    if [ ! -f "$work/${v}.live_chat.json" ]; then
      yt-dlp --skip-download --write-subs --sub-langs live_chat --sub-format json \
        -o "$work/%(id)s.%(ext)s" "https://www.youtube.com/watch?v=${v}" >/dev/null 2>&1 || true
    fi
    [ -s "$work/${v}.live_chat.json" ] && got=$((got + 1))
  done

  if [ "$got" -eq 0 ]; then
    echo "— チャットなし"
    rm -rf "$work"
    continue
  fi

  # Counted, then thrown away.
  found=$(node tools/mine-chat.mjs "$ch" "$work"/*.live_chat.json 2>/dev/null | head -1 || true)
  rm -rf "$work"
  echo "${got}配信 → ${found#*→ }"
done

echo
echo "${org}: ${total}チャンネル（うち ${done_already} は済み）"
echo "tools/candidates/ — $(ls -1 tools/candidates/*.json 2>/dev/null | wc -l | tr -d ' ')件"
