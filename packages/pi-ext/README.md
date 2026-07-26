# pi-ext

A practical extension pack for [Pi](https://pi.dev): command palettes, code
review, session workflows, terminal integrations, compact UI, skills, and a
theme.

## Install

```bash
pi install npm:@iurysza/pi-ext
```

Restart Pi or run `/reload` after installation.

To load only selected resources, filter the package in `settings.json`:

```json
{
  "packages": [
    {
      "source": "npm:@iurysza/pi-ext",
      "extensions": [
        "extensions/leader-key/index.ts",
        "extensions/review/review.ts"
      ],
      "skills": ["skills/sem"]
    }
  ]
}
```

Omit a resource type to load all of it. Use an empty array to load none.

## Extensions

| Extension | Description |
| --- | --- |
| [Leader Key](extensions/leader-key) | `Ctrl+X` command palette for sessions, models, thinking levels, labels, and extension commands. |
| [Chat to Markdown](extensions/chat-to-md) | Save the last assistant response under `ai-artifacts/chat/` with `/chat-to-md` or `Ctrl+X`, then `w`. |
| [Code Review](extensions/review) | `/review` workflows for pull requests, branches, commits, and uncommitted changes. |
| [pi-sem](extensions/pi-sem) | Entity-aware Git diff, context, history, blame, and impact tools powered by `sem`. |
| [Pi Telescope](extensions/pi-telescope) | Native fuzzy finder for sessions, files, commands, and other providers. |
| [Custom Footer](extensions/custom-footer) | Compact status line with Git, token, context, timing, and model information. |
| [Tool Pills](extensions/tool-pills) | Compact tool labels, collapsible output, and highlighted write/edit diffs. |
| [Permissions](extensions/permissions) | Switchable `yolo`, `safe`, and `read-only` command policies. |
| [Session Query](extensions/session-query) | Ask focused questions about previous Pi session files. |
| [Session Store](extensions/session-store) | Search indexed session history with `/search`. |
| [Session Snap](extensions/session-snap) | Review, archive, restore, and remove old sessions. |
| [Handoff](extensions/handoff) | Transfer compacted context to a fresh Pi session. |
| [Split Fork](extensions/split-fork) | Fork the current session into a tmux, cmux, or Herdr split or tab. |
| [Ask User](extensions/ask-user-question) | Structured single- or multi-select questions with an interactive Pi UI. |
| [cmux](extensions/cmux) | Notifications, status, browser, and workspace integration for cmux. |
| [Superconductor](extensions/superconductor) | Worktree status and controls when Pi runs under Superconductor. |

### Leader Key

Press `Ctrl+X` to open the palette. Actions are grouped by single-character
keys and include model switching, favourite models, thinking level, session
operations, labels, extension commands, and workflow shortcuts.

Favourite model presets live in
`extensions/leader-key/favourite-models.json`. Optional display roles live in
`extensions/leader-key/model-nicknames.json`.

### Chat to Markdown

Run `/chat-to-md` or press `Ctrl+X`, then `w`. The extension writes the last
textual assistant response from the active session branch to the current Git
repository's `ai-artifacts/chat/` directory. Files use
`YYYY-MM-DD-<response-slug>.md`; repeated saves add a numeric suffix instead of
overwriting an existing note.

### Permissions

Use `/mode` to switch policy:

- `yolo` allows every command.
- `safe` applies rules and asks about unknown shell commands.
- `read-only` blocks repository and home-directory writes.

Rules merge from project `.agents/permissions.json`, global
`~/.pi/agent/permissions.json`, and built-ins.

### Review and semantic tools

`/review` can inspect a GitHub pull request, compare against a base branch,
review uncommitted changes, inspect one commit, or follow custom instructions.
Projects can add `REVIEW_GUIDELINES.md`.

When `pi-sem` is loaded, review agents can use:

- `sem_diff` for changed entities;
- `sem_impact` for dependents and affected tests;
- `sem_context` for focused function or class context;
- `sem_log`, `sem_entities`, and `sem_blame` for history and ownership; and
- `sem_eval` to compare semantic and raw Git diff coverage.

The optional `@ataraxy-labs/sem` dependency installs automatically when the
platform supports it. You can also install `sem` with Homebrew or Cargo.

### Session workflows

- `/snap` reviews old sessions before archiving or deleting them.
- `/archive` browses archived sessions for restore or permanent removal.
- `/handoff [--tab] <goal>` starts a fresh session with compacted context.
- `/split-fork [--tab]` forks into Herdr, tmux, or cmux.
- `/search` searches the local session index.

Multiplexer integrations stay quiet when their host application is absent.

## Skills

| Skill | Description |
| --- | --- |
| [commit](skills/commit) | Create concise Conventional Commit messages from the current diff. |
| [github](skills/github) | Work with issues, pull requests, and CI through `gh`. |
| [pr-review-comments](skills/pr-review-comments) | Triage and resolve pull-request review comments. |
| [sem](skills/sem) | Apply entity-aware context and impact analysis during code review. |
| [session-query](skills/session-query) | Recover decisions and details from previous Pi sessions. |
| [visit-webpage](skills/visit-webpage) | Extract readable Markdown or download an image from a URL. |
| [web-search](skills/web-search) | Search the web through Jina without opening a browser. |

## Theme

[Catppuccin Mocha](themes/catppuccin-mocha.json) provides a dark Pi theme based
on the [Catppuccin](https://github.com/catppuccin/catppuccin) palette.

## Requirements

- Pi
- Node.js 22.19 or newer
- Optional host tools only for their matching integrations: `gh`, `sem`, Herdr,
  tmux, cmux, or Superconductor

## License

MIT © 2025 tomsej, © 2026 Iury Souza. This package derives from
[tomsej/pi-ext](https://github.com/tomsej/pi-ext); component attribution remains
in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).