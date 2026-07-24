#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VARIANTS="$ROOT/shaders/variants"
RUNTIME="${XDG_STATE_HOME:-$HOME/.local/state}/ghost-in-the-machine"
SHADER_CONFIG="$RUNTIME/ghostty-state.conf"
SIDEBAR_STATE="$RUNTIME/sidebar.state"
WATCHERS_DIR="$RUNTIME/watchers"
WATCHER="${GHOST_SIDEBAR_WATCHER_PATH:-$ROOT/scripts/sidebar-watcher.mjs}"
STATE_DIR="$RUNTIME/panes"
if [[ -n "${HERDR_BIN_PATH:-}" ]]; then
    HERDR_BIN="$HERDR_BIN_PATH"
elif command -v herdr >/dev/null 2>&1; then
    HERDR_BIN="$(command -v herdr)"
elif [[ -x "$HOME/.local/bin/herdr" ]]; then
    HERDR_BIN="$HOME/.local/bin/herdr"
else
    HERDR_BIN=herdr
fi

mkdir -p "$RUNTIME" "$STATE_DIR" "$WATCHERS_DIR"

usage() {
    echo "usage: ghost-state {set STATE|clear|focus|apply STATE|sidebar collapsed|sidebar expanded [PANE_ID]|watch-start|watch-stop|status|config-path}" >&2
    echo "states: off idle thinking working done error" >&2
    exit 2
}

valid_state() {
    case "$1" in
        off|idle|thinking|working|done|error) return 0 ;;
        *) return 1 ;;
    esac
}

session_key() {
    printf '%s' "${HERDR_SOCKET_PATH:-direct}" | cksum | awk '{print $1}'
}

pane_state_file() {
    local pane_id="$1" safe
    safe="$(printf '%s' "$pane_id" | tr -c 'A-Za-z0-9._-' '_')"
    printf '%s/%s-%s.state\n' "$STATE_DIR" "$(session_key)" "$safe"
}

current_pane() {
    "$HERDR_BIN" pane current 2>/dev/null
}

reload_ghostty() {
    local pid
    [[ "${GHOSTTY_RELOAD_ENABLED:-1}" == "1" ]] || return 0
    while read -r pid; do
        [[ -n "$pid" ]] && kill -USR2 "$pid" 2>/dev/null || true
    done < <(pgrep -x ghostty 2>/dev/null || true)
}

sidebar_state() {
    cat "$SIDEBAR_STATE" 2>/dev/null || printf 'expanded\n'
}

apply_state() {
    local requested="$1" state source config_tmp state_tmp current
    valid_state "$requested" || usage
    state="$requested"
    if [[ "$state" != "off" && "$(sidebar_state)" == "collapsed" ]]; then
        state=off
    fi
    source="$VARIANTS/$state.glsl"
    if [[ "$state" != "off" && ! -f "$source" ]]; then
        echo "missing bundled shader: $source" >&2
        exit 1
    fi

    config_tmp="$RUNTIME/.ghostty-state.conf.$$"
    if [[ "$state" == "off" ]]; then
        printf '# ghost-in-the-machine: off\n' > "$config_tmp"
    else
        printf 'custom-shader = %s\n' "$source" > "$config_tmp"
    fi

    current="$(cat "$RUNTIME/active.state" 2>/dev/null || true)"
    if [[ "$current" == "$state" && -f "$SHADER_CONFIG" ]] && cmp -s "$config_tmp" "$SHADER_CONFIG"; then
        rm -f "$config_tmp"
        return
    fi

    mv "$config_tmp" "$SHADER_CONFIG"
    state_tmp="$RUNTIME/.active.state.$$"
    printf '%s\n' "$state" > "$state_tmp"
    mv "$state_tmp" "$RUNTIME/active.state"
    reload_ghostty

    # A collapse can race this write. Reconcile after the write so an older Pi
    # lifecycle command cannot leave the ghost visible over a collapsed sidebar.
    if [[ "$requested" != "off" && "$state" != "off" && "$(sidebar_state)" == "collapsed" ]]; then
        apply_state off
    fi
}

focused_state() {
    local expected_pane="${1:-}" layout_json pane_json pane_id agent focused saved
    if [[ -z "$expected_pane" ]]; then
        layout_json="$("$HERDR_BIN" pane layout 2>/dev/null)" || {
            apply_state off
            return 1
        }
        expected_pane="$(jq -r '.result.layout.focused_pane_id // empty' <<<"$layout_json")"
    fi
    [[ -n "$expected_pane" ]] || {
        apply_state off
        return 1
    }

    pane_json="$("$HERDR_BIN" pane get "$expected_pane" 2>/dev/null)" || {
        apply_state off
        return 1
    }
    pane_id="$(jq -r '.result.pane.pane_id // empty' <<<"$pane_json")"
    agent="$(jq -r '.result.pane.agent // empty' <<<"$pane_json")"
    focused="$(jq -r '.result.pane.focused // false' <<<"$pane_json")"
    if [[ "$pane_id" != "$expected_pane" || "$focused" != "true" ]]; then
        apply_state off
        return 1
    fi
    if [[ "$agent" != "pi" ]]; then
        apply_state off
        return
    fi

    saved="$(cat "$(pane_state_file "$pane_id")" 2>/dev/null || true)"
    valid_state "$saved" || saved=off
    apply_state "$saved"
}

restore_focused_state() {
    local expected_pane="${1:-}" attempt
    for attempt in $(seq 1 20); do
        focused_state "$expected_pane" && return
        sleep 0.05
    done
    return 1
}

set_state() {
    local state="$1" pane_id="${HERDR_PANE_ID:-}" pane_json current_id focused
    valid_state "$state" || usage

    if [[ "${HERDR_ENV:-}" != "1" || -z "$pane_id" ]]; then
        apply_state "$state"
        return
    fi

    printf '%s\n' "$state" > "$(pane_state_file "$pane_id")"
    pane_json="$(current_pane)" || return
    current_id="$(jq -r '.result.pane.pane_id // empty' <<<"$pane_json")"
    focused="$(jq -r '.result.pane.focused // false' <<<"$pane_json")"
    if [[ "$current_id" == "$pane_id" && "$focused" == "true" ]]; then
        apply_state "$state"
        pane_json="$(current_pane)" || return
        current_id="$(jq -r '.result.pane.pane_id // empty' <<<"$pane_json")"
        focused="$(jq -r '.result.pane.focused // false' <<<"$pane_json")"
        [[ "$current_id" == "$pane_id" && "$focused" == "true" ]] || focused_state
    fi
}

canonical_socket_path() {
    local path="${HERDR_SOCKET_PATH:-${XDG_CONFIG_HOME:-$HOME/.config}/herdr/herdr.sock}" dir base
    [[ "$path" == /* ]] || path="$PWD/$path"
    if [[ -e "$path" ]] && command -v realpath >/dev/null 2>&1; then
        realpath "$path"
        return
    fi
    dir="${path%/*}"
    base="${path##*/}"
    if [[ -d "$dir" ]]; then
        dir="$(cd "$dir" && pwd -P)"
    fi
    printf '%s/%s\n' "${dir%/}" "$base"
}

watcher_paths() {
    local key
    WATCH_SOCKET="$(canonical_socket_path)"
    if [[ "${WATCH_SOCKET##*/}" == "herdr-client.sock" ]]; then
        echo "herdr-client.sock is not an API socket" >&2
        return 1
    fi
    key="$(printf '%s' "$WATCH_SOCKET" | shasum -a 256 | awk '{print $1}')"
    WATCH_DIR="$WATCHERS_DIR/$key"
    WATCH_PID="$WATCH_DIR/watcher.pid"
    WATCH_LOG="$WATCH_DIR/watcher.log"
    WATCH_SOCKET_FILE="$WATCH_DIR/socket-path"
    WATCH_LOCK="$WATCH_DIR/start.lock"
}

watcher_running() {
    local pid command identity
    pid="$(cat "$WATCH_PID" 2>/dev/null || true)"
    [[ "$pid" =~ ^[0-9]+$ ]] || return 1
    kill -0 "$pid" 2>/dev/null || return 1
    command="$(ps -p "$pid" -o command= 2>/dev/null || true)"
    identity="--socket $WATCH_SOCKET --log $WATCH_LOG --pid-file $WATCH_PID --socket-file $WATCH_SOCKET_FILE --controller"
    [[ "$command" == *"$identity"* ]]
}

release_watcher_lock() {
    local owner
    owner="$(cat "$WATCH_LOCK/owner.pid" 2>/dev/null || true)"
    if [[ "$owner" == "$$" ]]; then
        rm -rf "$WATCH_LOCK"
    fi
}

lock_mtime() {
    stat -c %Y "$1" 2>/dev/null || stat -f %m "$1" 2>/dev/null || echo 0
}

acquire_watcher_lock() {
    local owner attempt lock_age lock_mtime_value now stale_seconds max_attempts
    stale_seconds="${GHOST_WATCH_LOCK_STALE_SECONDS:-5}"
    [[ "$stale_seconds" =~ ^[0-9]+$ ]] || stale_seconds=5
    max_attempts=$((stale_seconds * 20 + 40))
    for attempt in $(seq 1 "$max_attempts"); do
        if mkdir "$WATCH_LOCK" 2>/dev/null; then
            printf '%s\n' "$$" > "$WATCH_LOCK/owner.pid"
            return 0
        fi
        watcher_running && return 1
        owner="$(cat "$WATCH_LOCK/owner.pid" 2>/dev/null || true)"
        if [[ "$owner" =~ ^[0-9]+$ ]]; then
            if ! kill -0 "$owner" 2>/dev/null; then
                rm -rf "$WATCH_LOCK"
                continue
            fi
        else
            lock_mtime_value="$(lock_mtime "$WATCH_LOCK")"
            now="$(date +%s)"
            lock_age=$((now - lock_mtime_value))
            if (( lock_age >= stale_seconds )); then
                rm -rf "$WATCH_LOCK"
                continue
            fi
        fi
        sleep 0.05
    done
    return 1
}

start_watcher() {
    local node_bin pid attempt
    [[ "${HERDR_ENV:-}" == "1" ]] || return 0
    watcher_paths || return
    mkdir -p "$WATCH_DIR"
    watcher_running && return 0
    if ! acquire_watcher_lock; then
        watcher_running && return 0
        echo "could not acquire watcher start lock for $WATCH_SOCKET" >&2
        return 1
    fi
    if watcher_running; then
        release_watcher_lock
        return 0
    fi

    if [[ -n "${NODE_BIN_PATH:-}" ]]; then
        node_bin="$NODE_BIN_PATH"
    elif command -v node >/dev/null 2>&1; then
        node_bin="$(node -p 'process.execPath')"
    else
        node_bin=""
    fi
    if [[ -z "$node_bin" ]]; then
        release_watcher_lock
        echo "node is required for the sidebar watcher" >&2
        return 127
    fi

    rm -f "$WATCH_PID"
    printf '%s\n' "$WATCH_SOCKET" > "$WATCH_SOCKET_FILE"
    HERDR_BIN_PATH="$HERDR_BIN" SIDEBAR_POLL_INTERVAL="${SIDEBAR_POLL_INTERVAL:-0.05}" \
        nohup "$node_bin" "$WATCHER" \
            --socket "$WATCH_SOCKET" \
            --log "$WATCH_LOG" \
            --pid-file "$WATCH_PID" \
            --socket-file "$WATCH_SOCKET_FILE" \
            --controller "${GHOST_CONTROLLER_PATH:-$ROOT/scripts/ghost-state.sh}" \
            </dev/null >/dev/null 2>&1 &
    pid=$!

    for attempt in $(seq 1 100); do
        if watcher_running; then
            release_watcher_lock
            return 0
        fi
        kill -0 "$pid" 2>/dev/null || break
        sleep 0.02
    done

    watcher_running && {
        release_watcher_lock
        return 0
    }
    kill -TERM "$pid" 2>/dev/null || true
    rm -f "$WATCH_PID"
    release_watcher_lock
    echo "sidebar watcher failed to start for $WATCH_SOCKET" >&2
    return 1
}

stop_watcher() {
    local pid attempt
    watcher_paths || return
    pid="$(cat "$WATCH_PID" 2>/dev/null || true)"
    if watcher_running; then
        kill -TERM "$pid" 2>/dev/null || true
        for attempt in $(seq 1 350); do
            kill -0 "$pid" 2>/dev/null || break
            sleep 0.02
        done
        if kill -0 "$pid" 2>/dev/null; then
            kill -KILL "$pid" 2>/dev/null || true
            for attempt in $(seq 1 50); do
                kill -0 "$pid" 2>/dev/null || break
                sleep 0.02
            done
        fi
        if kill -0 "$pid" 2>/dev/null; then
            echo "sidebar watcher $pid did not stop" >&2
            return 1
        fi
    fi
    rm -f "$WATCH_PID"
}

set_sidebar_state() {
    local state="$1" expected_pane="${2:-}" tmp
    case "$state" in
        collapsed|expanded) ;;
        *) usage ;;
    esac

    tmp="$RUNTIME/.sidebar.state.$$"
    printf '%s\n' "$state" > "$tmp"
    mv "$tmp" "$SIDEBAR_STATE"

    if [[ "$state" == "collapsed" ]]; then
        apply_state off
    else
        restore_focused_state "$expected_pane"
    fi
}

clear_state() {
    local pane_id="${HERDR_PANE_ID:-}" pane_json current_id focused
    if [[ -z "$pane_id" ]]; then
        apply_state off
        return
    fi

    rm -f "$(pane_state_file "$pane_id")"
    pane_json="$(current_pane)" || return
    current_id="$(jq -r '.result.pane.pane_id // empty' <<<"$pane_json")"
    focused="$(jq -r '.result.pane.focused // false' <<<"$pane_json")"
    if [[ "$current_id" == "$pane_id" && "$focused" == "true" ]]; then
        apply_state off
        pane_json="$(current_pane)" || return
        current_id="$(jq -r '.result.pane.pane_id // empty' <<<"$pane_json")"
        focused="$(jq -r '.result.pane.focused // false' <<<"$pane_json")"
        [[ "$current_id" == "$pane_id" && "$focused" == "true" ]] || focused_state
    fi
}

case "${1:-}" in
    set)
        [[ $# -eq 2 ]] || usage
        set_state "$2"
        ;;
    clear)
        [[ $# -eq 1 ]] || usage
        clear_state
        ;;
    focus)
        [[ $# -eq 1 ]] || usage
        focused_state
        ;;
    apply)
        [[ $# -eq 2 ]] || usage
        apply_state "$2"
        ;;
    sidebar)
        [[ $# -eq 2 || ( $# -eq 3 && "$2" == "expanded" ) ]] || usage
        set_sidebar_state "$2" "${3:-}"
        ;;
    watch-start)
        [[ $# -eq 1 ]] || usage
        start_watcher
        ;;
    watch-stop)
        [[ $# -eq 1 ]] || usage
        stop_watcher
        ;;
    status)
        [[ $# -eq 1 ]] || usage
        watcher_paths || exit 1
        if watcher_running; then
            watcher=running
            watcher_pid="$(cat "$WATCH_PID")"
        else
            watcher=stopped
            watcher_pid=none
        fi
        printf 'active=%s sidebar=%s watcher=%s watcher_pid=%s socket=%s\n' \
            "$(cat "$RUNTIME/active.state" 2>/dev/null || echo unknown)" \
            "$(sidebar_state)" \
            "$watcher" \
            "$watcher_pid" \
            "$WATCH_SOCKET"
        ;;
    config-path)
        [[ $# -eq 1 ]] || usage
        printf '%s\n' "$SHADER_CONFIG"
        ;;
    *) usage ;;
esac
