#!/usr/bin/env bash
# Rebuild packages/pi-mpl-chart/vendor/mpl from ivarvong/mpl at a pinned commit. mpl needs Node 24+ to build.
set -euo pipefail
SHA="${MPL_SHA:-689ebd4383c0f55b4219e73303f0b1dea6660bbf}"
NODE_BIN="${MPL_NODE:-/opt/homebrew/bin/node}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
git clone -q https://github.com/ivarvong/mpl "$TMP/mpl"
git -C "$TMP/mpl" checkout -q "$SHA"
export PATH="$(dirname "$NODE_BIN"):$PATH"
( cd "$TMP/mpl" && npm ci --ignore-scripts >/dev/null && "$NODE_BIN" scripts/build_package.ts )
OUT="$HERE/vendor/mpl"
rm -rf "$OUT" && mkdir -p "$OUT"
cp -R "$TMP/mpl/dist/browser" "$OUT/browser"
cp "$TMP/mpl/LICENSE" "$TMP/mpl/THIRD_PARTY_NOTICES.md" "$OUT/"
cat > "$OUT/PROVENANCE.md" <<P
# mpljs (vendored build)

- Source: https://github.com/ivarvong/mpl
- Commit: $SHA
- Version: 0.1.0, licence ISC (see LICENSE, THIRD_PARTY_NOTICES.md)
- Built with: $("$NODE_BIN" -v) via \`npm run build\` (dist/browser)
- Rebuild: packages/pi-mpl-chart/scripts/vendor-mpl.sh
P
echo "vendored mpl $SHA into $OUT"
