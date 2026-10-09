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
