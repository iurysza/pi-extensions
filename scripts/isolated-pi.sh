#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
real_home="${HOME:?HOME is required}"
mode="tui"

case "${1:-}" in
  --check)
    mode="check"
    shift
    ;;
  --help|-h)
    cat <<'EOF'
Usage: scripts/isolated-pi.sh [--check] [pi arguments...]

Without --check, starts an interactive Pi TUI with only this monorepo loaded.
The temporary HOME, copied auth, settings, sessions, and workspace are deleted
when the command exits.
EOF
    exit 0
    ;;
esac

for command in jq node pi; do
  if ! command -v "$command" >/dev/null 2>&1; then
    printf 'Missing required command: %s\n' "$command" >&2
    exit 1
  fi
done

live_agent_dir="$real_home/.pi/agent"
live_settings="$live_agent_dir/settings.json"
live_auth="$live_agent_dir/auth.json"
live_keybindings="$live_agent_dir/keybindings.json"

if [[ ! -f "$live_settings" ]]; then
  printf 'Missing live Pi settings: %s\n' "$live_settings" >&2
  exit 1
fi
if [[ ! -f "$live_auth" ]]; then
  printf 'Missing live Pi auth: %s\n' "$live_auth" >&2
  exit 1
fi

sandbox="$(mktemp -d "${TMPDIR:-/tmp}/pi-extensions-isolated.XXXXXX")"
cleanup() {
  chmod -R u+w "$sandbox" 2>/dev/null || true
  rm -rf "$sandbox"
}
trap cleanup EXIT

sandbox_home="$sandbox/home"
agent_dir="$sandbox_home/.pi/agent"
workspace="$sandbox/workspace"
mkdir -p "$agent_dir" "$workspace" \
  "$sandbox_home/.cache" \
  "$sandbox_home/.config" \
  "$sandbox_home/.local/share" \
  "$sandbox_home/.local/state"
install -m 600 "$live_auth" "$agent_dir/auth.json"
if [[ -f "$live_keybindings" ]]; then
  install -m 600 "$live_keybindings" "$agent_dir/keybindings.json"
fi

jq --arg source "$root" '
  {
    packages: [{ source: $source }],
    defaultProvider,
    defaultModel,
    defaultThinkingLevel,
    theme,
    hideThinkingBlock,
    quietStartup,
    transport,
    lastChangelogVersion
  }
  | with_entries(select(.value != null))
' "$live_settings" > "$agent_dir/settings.json"
chmod 600 "$agent_dir/settings.json"

sandbox_env=(
  "HOME=$sandbox_home"
  "PI_CODING_AGENT_DIR=$agent_dir"
  "XDG_CACHE_HOME=$sandbox_home/.cache"
  "XDG_CONFIG_HOME=$sandbox_home/.config"
  "XDG_DATA_HOME=$sandbox_home/.local/share"
  "XDG_STATE_HOME=$sandbox_home/.local/state"
)

printf 'Isolated package: %s\n' "$root"
printf 'Disposable HOME: %s\n' "$sandbox_home"

if [[ "$mode" == "check" ]]; then
  env "${sandbox_env[@]}" node "$root/scripts/check-isolated-pi.mjs" "$root" "$workspace"
else
  cd "$workspace"
  env "${sandbox_env[@]}" pi --no-context-files "$@"
fi
