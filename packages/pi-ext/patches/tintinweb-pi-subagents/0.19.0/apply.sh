#!/usr/bin/env bash
# Apply (or --revert / --status) tool-pills.patch on the installed @tintinweb/pi-subagents 0.19.0.
# Usage: apply.sh [--revert|--status] [PACKAGE_DIR]
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
patch_file="$here/tool-pills.patch"
mode=apply
if [[ "${1:-}" == "--revert" ]]; then mode=revert; shift; elif [[ "${1:-}" == "--status" ]]; then mode=status; shift; fi
pkg="${1:-$HOME/.local/share/agents2/tools/tintinweb-pi-subagents/0.19.0/node_modules/@tintinweb/pi-subagents}"
[[ -f "$pkg/src/index.ts" ]] || { echo "package not found: $pkg" >&2; exit 1; }
cd "$pkg"
applied() { git apply --check -R -p1 "$patch_file" >/dev/null 2>&1; }
clean() { git apply --check -p1 "$patch_file" >/dev/null 2>&1; }
case "$mode" in
  status) if applied; then echo "applied"; elif clean; then echo "not applied"; else echo "unknown: patch neither applies nor reverts cleanly" >&2; exit 2; fi ;;
  apply)
    if applied; then echo "already applied"; exit 0; fi
    clean || { echo "patch does not apply cleanly (package version changed?)" >&2; exit 2; }
    git apply -p1 "$patch_file"; echo "applied; run /reload in pi" ;;
  revert)
    if ! applied; then echo "not applied"; exit 0; fi
    git apply -R -p1 "$patch_file"; echo "reverted; run /reload in pi" ;;
esac
