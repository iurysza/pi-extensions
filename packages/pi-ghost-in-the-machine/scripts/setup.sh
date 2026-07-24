#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GHOSTTY_CONFIG="${XDG_CONFIG_HOME:-$HOME/.config}/ghostty/config"
STATE_CONFIG="$("$ROOT/scripts/ghost-state.sh" config-path)"
INCLUDE_LINE="config-file = ?$STATE_CONFIG"

mkdir -p "$(dirname "$GHOSTTY_CONFIG")"
touch "$GHOSTTY_CONFIG"

updated=false
if ! grep -Fqx "$INCLUDE_LINE" "$GHOSTTY_CONFIG"; then
    {
        printf '\n# Pi lifecycle face managed by pi-ghost-in-the-machine.\n'
        printf '%s\n' "$INCLUDE_LINE"
    } >> "$GHOSTTY_CONFIG"
    updated=true
fi
if ! grep -Eq '^[[:space:]]*custom-shader-animation[[:space:]]*=[[:space:]]*(true|always)[[:space:]]*$' "$GHOSTTY_CONFIG"; then
    printf 'custom-shader-animation = true\n' >> "$GHOSTTY_CONFIG"
    updated=true
fi

if [[ "$updated" == "true" ]]; then
    echo "updated $GHOSTTY_CONFIG"
else
    echo "Ghostty config already includes ghost state"
fi

if command -v herdr >/dev/null 2>&1; then
    linked_root="$(herdr plugin list --plugin ghost-in-the-machine --json | jq -r '.result.plugins[0].plugin_root // empty')"
    if [[ -n "$linked_root" && "$linked_root" != "$ROOT" ]]; then
        herdr plugin unlink ghost-in-the-machine
        linked_root=""
    fi
    if [[ -z "$linked_root" ]]; then
        herdr plugin link "$ROOT"
    else
        echo "Herdr focus plugin already linked"
    fi
else
    echo "herdr not found; skipping focus plugin link" >&2
fi

"$ROOT/scripts/ghost-state.sh" watch-start
"$ROOT/scripts/ghost-state.sh" apply idle
echo "ghost-in-the-machine setup complete"
