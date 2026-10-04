#!/usr/bin/env bash
# Apply (or --revert / --status) tool-pills.patch on the installed @tintinweb/pi-subagents 0.19.0.
# Usage: apply.sh [--revert|--status] [PACKAGE_DIR]
# Idempotent. Upgrades the v1 patch (legacy/) in place. All-or-nothing: if the
# patch does not apply cleanly (e.g. package version changed), nothing is touched and exit is 2.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
patch_file="$here/tool-pills.patch"
legacy_file="$here/legacy/tool-pills.v1.patch"
mode=apply
if [[ "${1:-}" == "--revert" ]]; then mode=revert; shift; elif [[ "${1:-}" == "--status" ]]; then mode=status; shift; fi
pkg="${1:-$HOME/.local/share/agents2/tools/tintinweb-pi-subagents/0.19.0/node_modules/@tintinweb/pi-subagents}"
[[ -f "$pkg/src/index.ts" ]] || { echo "package not found: $pkg" >&2; exit 1; }
cd "$pkg"
# git apply works outside a repo; --check never writes.
applied() { git apply --check -R -p1 "$1" >/dev/null 2>&1; }
clean() { git apply --check -p1 "$1" >/dev/null 2>&1; }
case "$mode" in
  status)
    if applied "$patch_file"; then echo "applied"
    elif applied "$legacy_file"; then echo "outdated: v1 applied; run apply.sh to upgrade" >&2; exit 3
    elif clean "$patch_file"; then echo "not applied"
    else echo "unknown: patch neither applies nor reverts cleanly (package version changed?)" >&2; exit 2; fi ;;
  apply)
    if applied "$patch_file"; then echo "already applied"; exit 0; fi
    if applied "$legacy_file"; then git apply -R -p1 "$legacy_file"; echo "reverted v1 patch"; fi
    clean "$patch_file" || { echo "tool-pills.patch does not apply cleanly (package version changed?). Nothing changed." >&2; exit 2; }
    git apply -p1 "$patch_file"; echo "applied; run /reload in pi" ;;
  revert)
    if applied "$legacy_file"; then git apply -R -p1 "$legacy_file"; echo "reverted v1; run /reload in pi"; exit 0; fi
    if ! applied "$patch_file"; then echo "not applied"; exit 0; fi
    git apply -R -p1 "$patch_file"; echo "reverted; run /reload in pi" ;;
esac
