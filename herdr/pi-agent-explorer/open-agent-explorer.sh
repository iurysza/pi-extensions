#!/usr/bin/env bash
set -euo pipefail

root="${HERDR_EXPLORER_ROOT:?Pi Agent Explorer snapshot is missing}"
[ -d "$root" ] || {
	printf 'Pi Agent Explorer snapshot does not exist: %s\n' "$root" >&2
	read -r -n 1 -p 'Press any key to close…' _ 2>/dev/null || sleep 2
	exit 1
}

exec nvim -R "$root"
