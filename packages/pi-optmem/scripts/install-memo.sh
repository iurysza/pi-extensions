#!/bin/sh
# Install OptMem's `memo` from a pinned upstream commit and verify its hash.
# OptMem has no licence, so this repository never ships `memo` itself.
#
# Usage: install-memo.sh [--prefix DIR] [--memory-dir DIR] [--no-init]
#   --prefix      where `memo` goes      (default: ~/.local/share/optmem)
#   --memory-dir  the memory store       (default: $MEMORY_DIR or <prefix>/memory)
#   --no-init     do not create the memory store
set -eu

COMMIT=1fb164cf39028047781f72ac3bb1e5a691c1dcb0
SHA256=3dc120d01be3115ef6267eab4103e7909fc830d6227b549f20991ba999ee9ffb
URL="https://raw.githubusercontent.com/VictorTaelin/OptMem/$COMMIT/memo"

prefix="$HOME/.local/share/optmem"
memory_dir=""
init=1
while [ $# -gt 0 ]; do
  case "$1" in
    --prefix) prefix="$2"; shift 2 ;;
    --memory-dir) memory_dir="$2"; shift 2 ;;
    --no-init) init=0; shift ;;
    -h|--help) sed -n '2,9p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done
[ -n "$memory_dir" ] || memory_dir="${MEMORY_DIR:-$prefix/memory}"

case "$memory_dir" in
  *obsidian-vault*) echo "Refusing $memory_dir: keep memory out of the synced vault." >&2; exit 1 ;;
esac

command -v python3 >/dev/null || { echo "python3 is required." >&2; exit 1; }

sha256() {
  if command -v shasum >/dev/null; then shasum -a 256 "$1" | cut -d' ' -f1
  else sha256sum "$1" | cut -d' ' -f1; fi
}

mkdir -p "$prefix"
tmp="$(mktemp "$prefix/.memo.XXXXXX")"
trap 'rm -f "$tmp"' EXIT
curl -fsSL "$URL" -o "$tmp"
actual="$(sha256 "$tmp")"
if [ "$actual" != "$SHA256" ]; then
  echo "Hash mismatch for $URL" >&2
  echo "  expected $SHA256" >&2
  echo "  actual   $actual" >&2
  exit 1
fi
chmod 755 "$tmp"
mv "$tmp" "$prefix/memo"
trap - EXIT
echo "Installed $prefix/memo (OptMem $COMMIT, sha256 ok)."

if [ "$init" -eq 1 ]; then
  if [ -d "$memory_dir" ]; then
    echo "Memory exists at $memory_dir. Not running init."
  else
    MEMORY_DIR="$memory_dir" "$prefix/memo" init >/dev/null
    echo "Created memory at $memory_dir."
  fi
fi
