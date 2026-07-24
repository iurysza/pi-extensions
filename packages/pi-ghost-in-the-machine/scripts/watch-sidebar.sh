#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ $# -gt 0 && "$1" != --* ]]; then
    log_file="$1"
    shift
    set -- --log "$log_file" "$@"
fi
if [[ -n "${NODE_BIN_PATH:-}" ]]; then
    node_bin="$NODE_BIN_PATH"
elif command -v node >/dev/null 2>&1; then
    node_bin="$(node -p 'process.execPath')"
else
    echo "node is required for the sidebar watcher" >&2
    exit 127
fi
exec "$node_bin" "$ROOT/scripts/sidebar-watcher.mjs" "$@"
