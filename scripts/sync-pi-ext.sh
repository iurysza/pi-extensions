#!/usr/bin/env bash
set -euo pipefail

root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [[ "$root" != "$(pwd)" ]]; then
  echo "Run this script from the pi-extensions repository root." >&2
  exit 1
fi

if [[ -n "$(git -c core.fsmonitor=false status --short)" ]]; then
  echo "Refusing to synchronize into a dirty worktree." >&2
  exit 1
fi

if [[ ! -d packages/pi-ext ]]; then
  echo "packages/pi-ext has not been imported yet; upstream synchronization begins in Phase 6." >&2
  exit 1
fi

echo "Upstream synchronization is not enabled until Phase 6." >&2
exit 1
