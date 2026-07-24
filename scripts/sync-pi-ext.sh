#!/usr/bin/env bash
set -euo pipefail

root="$(git -c core.fsmonitor=false rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -z "$root" || "$root" != "$(pwd -P)" ]]; then
  echo "Run this script from the pi-extensions repository root." >&2
  exit 1
fi

if [[ -n "$(git -c core.fsmonitor=false status --short)" ]]; then
  echo "Refusing to synchronize into a dirty worktree." >&2
  exit 1
fi

if [[ ! -d packages/pi-ext ]]; then
  echo "packages/pi-ext is missing." >&2
  exit 1
fi

upstream="https://github.com/tomsej/pi-ext.git"
git subtree pull \
  --prefix=packages/pi-ext \
  --message="chore(sync): update pi-ext from tomsej upstream" \
  "$upstream" main

# Subtree conflicts intentionally remain in the worktree for human resolution.
npm run check:catalog

for legal_file in \
  packages/pi-ext/LICENSE \
  packages/pi-ext/THIRD_PARTY_NOTICES.md; do
  if [[ ! -f "$legal_file" ]]; then
    echo "Missing required pi-ext legal file: $legal_file" >&2
    exit 1
  fi
done

npm ci
npm run typecheck
npm test
npm run check:packs
