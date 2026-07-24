#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTROLLER="${GHOST_CONTROLLER_PATH:-$ROOT/scripts/ghost-state.sh}"
if [[ -n "${HERDR_BIN_PATH:-}" ]]; then
    HERDR_BIN="$HERDR_BIN_PATH"
elif command -v herdr >/dev/null 2>&1; then
    HERDR_BIN="$(command -v herdr)"
elif [[ -x "$HOME/.local/bin/herdr" ]]; then
    HERDR_BIN="$HOME/.local/bin/herdr"
else
    echo "herdr not found" >&2
    exit 127
fi

[[ "${HERDR_ENV:-}" == "1" ]] || {
    echo "live verification must run inside Herdr" >&2
    exit 2
}
pgrep -x ghostty >/dev/null 2>&1 || {
    echo "live verification needs a running Ghostty GUI to send the Herdr sidebar key" >&2
    exit 2
}
[[ -n "${HERDR_PANE_ID:-}" ]] || {
    echo "live verification needs HERDR_PANE_ID" >&2
    exit 2
}
pane_json="$("$HERDR_BIN" pane get "$HERDR_PANE_ID")"
[[ "$(jq -r '.result.pane.agent // empty' <<<"$pane_json")" == "pi" && \
   "$(jq -r '.result.pane.focused // false' <<<"$pane_json")" == "true" ]] || {
    echo "live verification pane $HERDR_PANE_ID must be the focused Pi pane" >&2
    exit 2
}

layout_x() {
    "$HERDR_BIN" pane layout --current | jq -r '.result.layout.area.x'
}

watcher_pid() {
    "$CONTROLLER" status | sed -n 's/.*watcher_pid=\([^ ]*\).*/\1/p'
}

toggle_sidebar() {
    osascript <<'APPLESCRIPT'
tell application "System Events"
    tell process "Ghostty"
        set frontmost to true
        keystroke "a" using control down
        delay 0.1
        keystroke "b"
    end tell
end tell
APPLESCRIPT
}

wait_for_layout() {
    local expected="$1" attempts="${2:-100}" attempt x
    for attempt in $(seq 1 "$attempts"); do
        x="$(layout_x)"
        if [[ "$expected" == "collapsed" && "$x" =~ ^[0-9]+$ ]] && (( x <= 4 )); then
            printf '%s\n' "$x"
            return 0
        fi
        if [[ "$expected" == "expanded" && "$x" =~ ^[0-9]+$ ]] && (( x > 4 )); then
            printf '%s\n' "$x"
            return 0
        fi
        sleep 0.05
    done
    echo "sidebar did not become $expected" >&2
    return 1
}

wait_for_status() {
    local expected="$1" attempt status
    for attempt in $(seq 1 100); do
        status="$($CONTROLLER status)"
        [[ "$status" == *"$expected"* ]] && {
            printf '%s\n' "$status"
            return 0
        }
        sleep 0.05
    done
    echo "status did not contain: $expected" >&2
    return 1
}

wait_for_visible_status() {
    local attempt status
    for attempt in $(seq 1 100); do
        status="$($CONTROLLER status)"
        if [[ "$status" =~ active=(idle|thinking|working|done|error) ]] && [[ "$status" == *"sidebar=expanded"* ]]; then
            printf '%s\n' "$status"
            return 0
        fi
        sleep 0.05
    done
    echo "expanded sidebar did not restore a visible state" >&2
    return 1
}

toggle_and_wait() {
    local expected="$1" attempt result
    for attempt in $(seq 1 3); do
        toggle_sidebar
        if result="$(wait_for_layout "$expected" 40)"; then
            printf '%s\n' "$result"
            return 0
        fi
    done
    echo "sidebar toggle did not reach $expected after 3 attempts" >&2
    return 1
}

ensure_expanded() {
    local x
    x="$(layout_x)"
    if [[ "$x" =~ ^[0-9]+$ ]] && (( x <= 4 )); then
        toggle_and_wait expanded >/dev/null
    fi
}

trap ensure_expanded EXIT
ensure_expanded

"$CONTROLLER" watch-start
first_pid="$(watcher_pid)"
"$CONTROLLER" watch-start
second_pid="$(watcher_pid)"
[[ "$first_pid" =~ ^[0-9]+$ && "$first_pid" == "$second_pid" ]] || {
    echo "watch-start was not idempotent: $first_pid != $second_pid" >&2
    exit 1
}
printf 'singleton_pid=%s\n' "$first_pid"

collapsed_x="$(toggle_and_wait collapsed)"
collapsed_status="$(wait_for_status 'active=off sidebar=collapsed')"
printf 'collapsed area_x=%s %s\n' "$collapsed_x" "$collapsed_status"

"$CONTROLLER" set working
suppressed_status="$(wait_for_status 'active=off sidebar=collapsed')"
printf 'suppressed %s\n' "$suppressed_status"

expanded_x="$(toggle_and_wait expanded)"
restored_status="$(wait_for_visible_status)"
printf 'expanded area_x=%s %s\n' "$expanded_x" "$restored_status"

"$CONTROLLER" watch-stop
"$CONTROLLER" watch-start
restarted_pid="$(watcher_pid)"
[[ "$restarted_pid" =~ ^[0-9]+$ ]] || {
    echo "watcher did not restart" >&2
    exit 1
}
printf 'restarted_pid=%s\n' "$restarted_pid"
