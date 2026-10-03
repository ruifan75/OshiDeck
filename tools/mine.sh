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
# Fifteen. Six was the first answer, from measuring how much the top of the
# list still moved — and that measured the wrong thing. The loudest few
# entries settle early and stay settled; what keeps arriving is the rest of
# the vocabulary. Of this channel's newest six streams four were singing
# streams, and the whole family of reaction words that only come up while
# she is talking — かわいい, すごい, いいね, わかる — was missing from the
# candidates entirely. Fifteen has them, and the singing-stream applause that
# six had at the top falls to where it belongs.
#
# Newest rather than a spread of kinds, which is the part that would not
# scale past one channel: picking a mix by hand means watching enough of
# somebody to know what their mix is.
set -e
cd "$(dirname "$0")/.."

channel=$1
want=${2:-15}

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
