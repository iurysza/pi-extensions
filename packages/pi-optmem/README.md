# pi-optmem

Per-session [OptMem](https://github.com/VictorTaelin/OptMem) memory for Pi. Install memory once. Each session runs with memory on, read-only or off.

Stock OptMem puts its instructions in `AGENTS.md`, which turns memory on in every session. This extension replaces that block. It adds the instructions, the wake view and the memo tools only to sessions that ask for them.

## Install

1. Install `memo` from the pinned upstream commit:

   ```sh
   packages/pi-optmem/scripts/install-memo.sh
   ```

   The script downloads `memo` from commit `1fb164cf39028047781f72ac3bb1e5a691c1dcb0`, checks its SHA-256, and installs it to `~/.local/share/optmem/memo`. If the memory directory does not exist, it runs `memo init`. Options: `--prefix DIR`, `--memory-dir DIR` and `--no-init`.

   OptMem has no licence, so this repository does not ship `memo`.

2. Load the extension. It is listed in the root `pi` manifest as `./packages/pi-optmem/src/index.ts`.

3. Do not paste OptMem's `## Memory` block into `AGENTS.md`. If you do, memory is on in every session.

If `memo` is missing, Pi still starts. The extension tells you how to install it.

## Modes

| | off | read | on |
|---|---|---|---|
| Memory instructions in the system prompt | no | read-only variant | full |
| Wake view injected | no | yes | yes |
| Tools | none | `memo_zoom`, `memo_recall` | `memo_note`, `memo_zoom`, `memo_recall`, `memo_nap` |
| Bash commands that mention memo | blocked | a simple `memo wake`, `zoom` or `recall` only | allowed |

The bash guard fails closed. In `off` it blocks any command that mentions `memo`, `memo.py`, the configured memo path or the memory directory. In `read` the only exception is a simple command: optional `VAR=value` prefixes, optional `python3`, then memo and `wake`, `zoom` or `recall`. Pipes, `;`, `&&`, conditionals, loops, redirections and substitutions are all blocked. This can block harmless commands such as `grep memo notes.md`.

The extension also blocks `edit` and `write` calls inside the memory directory.

The footer shows `mem:on`, `mem:read` or `mem:off`.

## Controls

- `/memory` shows the mode, where it came from, and the paths.
- `/memory on|read|off` switches the current session and saves the choice in the session.
- `--memory`, `--memory-read` and `--no-memory` set the starting mode. If you pass more than one, the most restrictive wins.

The starting mode is resolved in this order: flag, then the mode saved in the session, then a cwd rule, then `defaultMode`. Flags apply only to the first session of the process. `/reload`, `/new`, `/resume`, `/fork` and `/tree` navigation use the mode saved on the current branch, so a `/memory` switch survives them.

Switching mid-session:

- **On or read**: the wake view loads on the next turn. An explicit `/memory on` or `/memory read` also reloads it, for example after installing memo or finishing a compression.
- **Off**: memo tools are removed and bash calls to `memo` are blocked straight away. The next request has no memory instructions, and the wake view is filtered out of the context.
- Each switch costs one prompt-cache miss.

The wake view is never saved in the session. It is held in memory and added to each request, so compaction and branch summaries never see it. Wake messages saved by older versions are removed from requests, compaction input and branch-summary input. A successful wake is reused until compaction, a mode change or `/memory on|read`. A missing memo, an error or a pending compression is retried on the next prompt.

## Config

Path: `~/.pi/agent/pi-optmem.json`, or the file named by `PI_OPTMEM_CONFIG`. Every field is optional:

```json
{
  "defaultMode": "off",
  "subagentMode": "off",
  "memoPath": "~/.local/share/optmem/memo",
  "memoryDir": "~/.local/share/optmem/memory",
  "rules": [
    { "cwd": "~/dev/personal/obsidian-vault", "mode": "on" }
  ]
}
```

- `defaultMode`: `off`, `read` or `on`. The shipped default is `off`.
- `subagentMode`: the highest mode a subagent can have, either `off` or `read`.
- `rules`: per-directory starting modes. The longest matching `cwd` prefix wins.
- `MEMORY_DIR` in the environment overrides `memoryDir`.

Keep the memory directory outside the Obsidian vault. Syncthing creates conflict copies of files that two machines change, and OptMem's fixed-width files do not merge. The installer refuses memory paths inside `obsidian-vault`.

The extension exports `MEMORY_DIR` for every `memo` call: its own tools and bash commands that run `memo`. All sessions use the same store.

## Privacy

Memory is plain text and permanent. Store pointers, not payloads. For example, write "Berlin flat lease terms: see vault `Housing/Lease.md`" instead of copying the details. Never store IDs, account numbers, credentials, tokens or other secrets. The "on" prompt tells the model this.

## Subagents

Subagents never write memories. A session counts as a subagent when any of these is true:

- It runs in `print` or `json` mode. `@tintinweb/pi-subagents` binds its child sessions (Agent tool, workflows, schedules) without a UI mode, so they run as `print`. Out-of-process spawners use `pi --mode json -p`.
- `PI_OPTMEM_SUBAGENT=1` is set.

Subagents are capped at `subagentMode` (default `off`), even with `--memory` or a matching rule. `/memory on` is refused in a subagent. Child sessions do not save a mode entry.

The memo tools also check the mode when they run. If a spawner reactivates them in a child, the call still fails.

Known gaps:

- A top-level `pi -p` or `pi --mode json` run that you start yourself also counts as a subagent.
- A child that runs in `tui` or `rpc` mode without `PI_OPTMEM_SUBAGENT=1` is not detected.
- The bash guard matches names, not files. A renamed copy of memo, or an alias, that is not the configured path gets past it. The memo tools check the mode themselves either way.

## Development

```sh
npm test --workspace @iurysza/pi-optmem
```

Tests never touch a real memory directory. The integration test copies `memo` into a temp directory and creates a temp store. It looks for `memo` in `PI_OPTMEM_TEST_MEMO`, `~/.local/share/optmem/memo` or `/tmp/memo.py`, and skips if none exists.
