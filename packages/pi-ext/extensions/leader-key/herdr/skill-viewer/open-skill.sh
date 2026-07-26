#!/usr/bin/env bash
set -euo pipefail

skill_path="${PI_EXT_SKILL_PATH:?Selected SKILL.md path is missing}"
[ -f "$skill_path" ] || {
	printf 'Skill file does not exist: %s\n' "$skill_path" >&2
	exit 1
}

editor="${PI_EXT_SKILL_EDITOR:-${VISUAL:-${EDITOR:-}}}"
if [ -z "$editor" ]; then
	if command -v nvim >/dev/null 2>&1; then
		editor="nvim"
	else
		editor="vi"
	fi
fi

read -r -a editor_command <<< "$editor"
exec "${editor_command[@]}" "$skill_path"
