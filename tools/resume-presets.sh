#!/bin/bash
# Run directly in the user's terminal so browser access uses that context.
# Both the terminal and the existing run log receive progress and errors.
set -euo pipefail
cd "$(dirname "$0")/.."

run=chat-presets-20261101
if [[ ! -f "$run/resume.mjs" || ! -f "$run/channels.json" ]]; then
  echo "FAIL the existing preset rebuild is missing: $run" >&2
  exit 1
fi
for program in node yt-dlp tee; do
  if ! command -v "$program" >/dev/null 2>&1; then
    echo "FAIL required program not found: $program" >&2
    exit 1
  fi
done

echo "Resuming presets: two download workers, one parser."
echo "Progress and errors: $run/mine.log"
node "$run/resume.mjs" 2>&1 | tee -a "$run/mine.log"
