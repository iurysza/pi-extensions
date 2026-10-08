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

## Compared with stock OptMem

In `on` mode, memory itself is unchanged. The extension runs the same `memo` against the same memory directory, so notes, the tree and naps are identical, and a store works with or without the extension.

What changes is how a session gets the instructions and the wake view:

| | Stock OptMem | pi-optmem `on` |
|---|---|---|
| Instructions | Upstream `## Memory` block in `AGENTS.md`, word for word, in every session | A rewritten section in the system prompt, only in `on` and `read` |
| Wake | The agent runs `memo wake` as its first tool call | The extension runs it before the turn, fetching every page |
| Wake output | A tool result saved in the transcript, then summarised by compaction | Added to each request and never saved. It reloads after compaction, even mid-run |
| Writing | `memo note` and `memo nap` in bash | `memo_note` and `memo_nap` tools. Bash memo commands still work |
| Compressions | memo's `Run: memo nap …` lines | The same requests, rewritten to name `memo_nap` |
| Subagents | Asked to skip memory | Capped at `subagentMode` and blocked from writing |

The rewritten instructions keep upstream's rules: read the wake view first, note anything worth keeping, avoid redundant notes, compress when asked, never edit the memory directory. They add one rule upstream lacks: store pointers, never IDs, credentials or other secrets. The agent may therefore save less detail than stock OptMem would.

In `read` mode, if memo needs compressions before it can wake, the session continues without memory, because it cannot nap.

## Modes

| | off | read | on |
|---|---|---|---|
| Memory instructions in the system prompt | no | read-only variant | full |
| Wake view injected | no | yes | yes |
| Tools | none | `memo_zoom`, `memo_recall` | `memo_note`, `memo_zoom`, `memo_recall`, `memo_nap` |
| Bash commands that mention memo | blocked | a simple `memo wake`, `zoom` or `recall` only | allowed |

The bash guard fails closed. In `off` it blocks any command that mentions `memo`, `memo.py`, the configured memo path or the memory directory. In `read` the only exception is a simple command: optional `VAR=value` prefixes, optional `python3`, then memo and `wake`, `zoom` or `recall`. Pipes, `;`, `&&`, conditionals, loops, redirections and substitutions are all blocked. This can block harmless commands such as `grep memo notes.md`.

The extension also blocks `edit` and `write` calls inside the memory directory.

The footer uses Nerd Font v3 icons (`src/status.ts`). Off shows nothing.

| State | Footer |
|---|---|
| on | `󰧑` |
| read | `󰧑 󰈈` |
| memo missing | `󰧑 󰀦 no memo` |
| generating / catching up | `󰧑 󰓦 120/1957`, `󰧑 󰓦 catchup 3/10` |
| draft waiting | `󰧑 󰄬 review` |
| importing | `󰧑 󰇚 import` |
| naps | `󰧑 󰒲 12/40` |
| job failed (until the next job) | `󰧑 󰀦 failed` |

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

Three layers, lowest first. A later layer replaces whole keys (`rules` is not merged):

1. Built-in defaults (below).
2. Profile defaults: `~/.pi/agent/pi-optmem.defaults.json`, or `PI_OPTMEM_DEFAULTS`. agents2 links this file. Do not edit it.
3. User config: `~/.pi/agent/pi-optmem.json`, or `PI_OPTMEM_CONFIG`. The leader menu's Defaults items write here. agents2 never touches it.

A layer that fails to parse is skipped with a warning, so a broken user file falls back to the profile defaults. Every field is optional:

```json
{
  "defaultMode": "off",
  "subagentMode": "off",
  "memoryDir": "~/.local/share/optmem/memory",
  "model": "openai-codex/gpt-6-luna",
  "flushBeforeCompact": true,
  "rules": [
    { "cwd": "~/dev/personal/obsidian-vault", "mode": "on" }
  ]
}
```

- `defaultMode`: `off`, `read` or `on`. The built-in default is `off`; the personal and work profiles set `on`.
- `subagentMode`: the highest mode a subagent can have, either `off` or `read`.
- `rules`: per-directory starting modes. The longest matching `cwd` prefix wins.
- `model`: the model for generation, background naps and pre-compaction flushes. agents2's `pi.optmem.model` sets the profile default. The personal profile uses `claude-code/claude-haiku-5-5`; work uses `github-copilot/gpt-6-luna`.
- `flushBeforeCompact`: saves durable facts before compaction, default `true`. Set it to `false` in the user config to disable it.
- `distilPrompt`: optional. Replaces the built-in distil rules; the sessions are appended after it. Edit it from the menu (Defaults → Distil prompt); saving it empty restores the built-in prompt.
- `memoPath`: optional. When unset, memo is found in this order: the agents2-installed copy (`~/.local/share/agents2/tools/optmem/<active rev>/memo`, active rev from `history.json`), then `~/.local/share/optmem/memo` (install-memo.sh).
- `MEMORY_DIR` in the environment overrides `memoryDir`.

The memory directory is created with `memo init` the first time a session loads it.

## Save facts before compaction

In `on` mode, `session_before_compact` starts a detached Pi worker. It reads the selected messages and split-turn prefix, without wake messages, plus the previous summary. New spans below 4,000 characters are skipped, roughly 1,000 tokens, to avoid model calls for short manual compactions. A previous summary alone does not trigger another flush.

Compaction does not wait for the model. The worker survives parent exit and works without a UI, including RPC exit compactions. It loads the configured providers and calls the selected model through `ctx.modelRegistry`, never pi-ai's built-in-only completion helper. It sends no agent prompt and cancels any attempted worker compaction.

The model returns at most 5 normal memory lines. The worker rejects multiline, over-280-byte and recognisable sensitive output. It asks the model to skip facts in the current wake view and checks exact normalised duplicates against the raw log before each append. Semantic duplicate detection still depends on the model. Concurrent flushes can save the same new fact, but cannot corrupt the store.

Every write goes through `memo note` or `memo nap`. Memo already holds an OS file lock while assigning IDs and appending records, then flushes and syncs the file. The worker pays requested naps before writing its next line. A failed call leaves already saved notes and any unpaid naps intact for a later session.

The transcript snapshot lives in a private temporary directory and is deleted when the worker finishes. Interactive and RPC sessions get a start notification. Results and counts, without transcripts or memory text, go to `<memoryDir>/../flush/flush.jsonl`. `/memory status` shows the model, setting and log path. If the worker is forcibly killed, its temporary snapshot may remain in the OS temp directory.

## Leader menu

Leader → `b` (Memory). Every item runs a `/memory` subcommand, which you can also type:

| Section | Items (`/memory …`) |
|---|---|
| This session | `on`, `read`, `off`, `status` |
| Browse | `view` (wake view), `search [regex]`, `zoom [lo-hi]`, `log` (LOG.txt, newest 5,000) |
| Files | `reveal` (open the folder), `config` (edit the user config, validated), `paths` (paths and memo version) |
| Defaults | `default [on\|read\|off]`, `rule [on\|read\|off\|clear]` for the current folder, `model [id]` |
| Maintenance | `stats`, `naps` (background), `forget [lo-hi]` |
| Generate | `generate` (or rebuild), `catchup`, `job`, `cancel` |

Viewers use Pi's editor dialog as a read-only pane: edits there are ignored. Without a UI, prompts must be passed as arguments.

Keep the memory directory outside the Obsidian vault. Syncthing creates conflict copies of files that two machines change, and OptMem's fixed-width files do not merge. The installer refuses memory paths inside `obsidian-vault`.

The extension exports `MEMORY_DIR` for every `memo` call: its own tools and bash commands that run `memo`. All sessions use the same store.

## Generate memory from sessions

Sessions are the source of truth; memory is derived from them. Leader → `b` → `g` → Generate builds memory from past Pi sessions in a background process that outlives Pi:

1. **Discover** top-level session files in `<agent dir>/sessions/<cwd-slug>/`. Skips `/tmp`, `/private/tmp` and `review-pr-*` folders, and files deeper than one folder (subagent runs). A forked session (`parentSession` in its header) keeps only entries newer than its own start, so copied parent history is not distilled twice.
2. **Extract**, no model: user messages plus the assistant's last text per turn, capped at about 12,000 characters per session. Every user message is kept; middle assistant replies go first.
3. **Distil** with the configured `model`: about 8 sessions per call, 4 calls at a time, retry with backoff. If the model is unknown or unauthorised on the first call, the job falls back to Pi's default model once and records it.
4. **Filter**: dates, 280 bytes, de-duplication and ascending dates. The drop count is logged. A regex privacy filter (digit runs, emails, IBANs, tokens, money, phones) exists but is off (`PRIVACY_FILTER` in `src/generate/filter.ts`) because it dropped too many useful lines; the distil prompt still forbids secrets.
5. **Confirm**: one dialog with the line count, date span, 12 sample lines, and Import / Open draft / Cancel. Only Import writes memory.
6. **Import** with `memo import`, then **naps**: pending summaries are batched 24 per model call and written in memo's order with `memo nap`.

Generate on a non-empty memory offers **Catch up** (only session entries newer than the last generated one, imported with their own dates) or **Rebuild** (confirm; on import the old dir moves to `memory.bak-YYYYMMDD-HHMM` under memo's lock, and a busy store refuses the move).

State lives in `<memoryDir>/../generate/`: `job.json`, `job.log`, `draft.txt`, `lines.jsonl`, `state.json` (last generated session time), `lock` (one job at a time) and `onboarding-shown`. A killed job resumes: run the same command again. The footer shows job progress (see Modes).

The model runs as `pi -p --model <id> --no-tools --no-session --no-skills --no-context-files` with `PI_OPTMEM_SUBAGENT=1`, so a child never wakes or writes memory. Extensions stay enabled so models such as `claude-code/...` have their provider registered. `PI_OPTMEM_MODEL_CMD` swaps in any command (model id as argument, prompt on stdin) for tests.

The same work from a terminal (Node 22.18+):

```sh
node packages/pi-optmem/scripts/generate.mjs --help
node packages/pi-optmem/scripts/generate.mjs generate --limit 40 --memory-dir /tmp/mem-pilot/memory
node packages/pi-optmem/scripts/generate.mjs rebuild --since 7d --project agents2 --min-turns 3 --memory-dir /tmp/mem-pilot/memory
node packages/pi-optmem/scripts/generate.mjs import --memory-dir /tmp/mem-pilot/memory
```

Without `--yes`, `generate`, `rebuild` and `catchup` stop at the draft.

On the first interactive session with an empty memory and memo installed, a one-time notification points at Generate.

Known gaps: abandoned branches inside a session file are distilled too; Rebuild does not merge live notes written since the last generation, but they exist in sessions and Rebuild re-derives them.

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

The opt-in real-provider test runs a fake RPC session, compacts it, exits Pi, then lets a detached Haiku worker write to a temporary store:

```sh
PI_OPTMEM_REAL_FLUSH_TEST=1 PI_OPTMEM_TEST_PROVIDER=/path/to/pi-claude-code npm test
```

The test uses a deterministic compaction summary to isolate the real flush call. It gates worker startup until the parent exits, so a fast response cannot hide a broken detach.

Tests never touch a real memory directory. The integration test copies `memo` into a temp directory and creates a temp store. It looks for `memo` in `PI_OPTMEM_TEST_MEMO`, `~/.local/share/optmem/memo` or `/tmp/memo.py`, and skips if none exists.
