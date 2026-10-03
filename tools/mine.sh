#!/bin/sh
# One channel, from nothing to a candidate list.
#
#   tools/mine.sh UCeqIMtLuGc3YgwkhEaG8oDg
#   tools/mine.sh UCeqIMtLuGc3YgwkhEaG8oDg 10
#
# Takes the newest archived streams that have a chat replay, downloads them,
# and ranks what the room says. Downloads land in chat/, which is git-ignored
# and safe to delete — they are a hundred megabytes and always re-fetchable.
#
# Six, because it was measured rather than guessed (tools/saturation.mjs):
# one stream has no way to tell a regular greeting from a one-night joke, the
# top of the list stops moving around the fifth, and past the twelfth it does
# not move at all. Six is where another download stops buying anything.
#
# Newest rather than a spread of kinds, also measured: against a hand-picked
# mix of singing, chatting and gaming streams, the newest six gave the same
# top thirteen in a slightly different order and dropped nothing.
set -e
cd "$(dirname "$0")/.."

channel=$1
want=${2:-6}

if [ -z "$channel" ]; then
  echo "usage: tools/mine.sh <UC…> [streams]"
  exit 1
fi

mkdir -p chat

echo "配信を探しています…"
# More than `want`, because some have no chat replay at all and premieres and
# placeholders have no duration.
ids=$(yt-dlp --skip-download --flat-playlist --playlist-end $((want * 3)) \
  --print "%(id)s|%(duration)s" \
  "https://www.youtube.com/channel/${channel}/streams" 2>/dev/null \
  | awk -F'|' '$2 != "NA" && $2 > 600 {print $1}')

got=0
files=""
for id in $ids; do
  [ "$got" -ge "$want" ] && break
  file="chat/${id}.live_chat.json"
  if [ ! -f "$file" ]; then
    yt-dlp --skip-download --write-subs --sub-langs live_chat --sub-format json \
      -o "chat/%(id)s.%(ext)s" "https://www.youtube.com/watch?v=${id}" >/dev/null 2>&1 || true
  fi
  # A members-only stream, or one whose replay was turned off, leaves nothing.
  if [ -s "$file" ]; then
    got=$((got + 1))
    files="$files $file"
    echo "  $got/$want  $id"
  fi
done

if [ "$got" -eq 0 ]; then
  echo "FAIL チャットの残っている配信が見つかりませんでした"
  exit 1
fi

echo
node tools/mine-chat.mjs "$channel" $files
