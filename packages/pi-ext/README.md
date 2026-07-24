```
           ██▓███   ██▓              ▓█████ ▒██   ██▒▄▄▄█████▓
          ▓██░  ██▒▓██▒              ▓█   ▀ ▒▒ █ █ ▒░▓  ██▒ ▓▒
          ▓██░ ██▓▒▒██▒   ▄▄▄▄▄     ▒███   ░░  █   ░▒ ▓██░ ▒░
          ▒██▄█▓▒ ▒░██░   ░░░░░     ▒▓█  ▄  ░ █ █ ▒ ░ ▓██▓ ░
          ▒██▒ ░  ░░██░              ░▒████▒▒██▒ ▒██▒  ▒██▒ ░
          ▒▓▒░ ░  ░░▓░              ░░ ▒░ ░▒▒ ░ ░▓ ░  ▒ ░░
          ░▒ ░     ░▒░               ░ ░  ░░░   ░▒ ░    ░
          ░░       ░░                  ░    ░    ░    ░
                                       ░  ░ ░
```


https://github.com/user-attachments/assets/d1e5f848-176f-43cb-85bb-3d518e5b0bdd



A collection of extensions, skills, and themes for [Pi](https://github.com/badlogic/pi), the AI coding agent for the terminal.

Extensions cover everything from UI polish (custom footer, tool pills, leader-key palette) to deep workflow tooling (semantic git review, session archiving, context handoff between sessions, cmux integration). The package is MIT licensed; derived components retain their original notices in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

This fork tracks [tomsej/pi-ext](https://github.com/tomsej/pi-ext) and adds:

- Herdr, tmux, and cmux-aware handoff and split-fork behavior
- A standalone `/split-fork` command
- Restored bash output rendering in Tool Pills
- OpenSpec workflow output that follows the active session language instead of forcing Czech

> *Leader key palette → fuzzy finder → semantic review → handoff to a fresh session*

## Install

```bash
pi install git:github.com/iurysza/pi-ext@main
```

Or using the full URL:

```bash
pi install https://github.com/iurysza/pi-ext@main
```

To install the full package but only load specific extensions or skills, use package filtering in your `settings.json`:

```json
{
  "packages": [
    {
      "source": "git:github.com/iurysza/pi-ext@main",
      "extensions": ["extensions/leader-key"],
      "skills": []
    }
  ]
}
```

See [Pi Packages docs](https://github.com/badlogic/pi/blob/main/docs/packages.md) for more filtering options.

Requires [Pi](https://github.com/badlogic/pi) v0.37.3+.

## Extensions

### [Leader Key](extensions/leader-key/)

Press `Ctrl+X` to open a floating command palette — like Vim's which-key or Emacs' leader key. Actions are organized into single-character groups (`s` for Session, `m` for Model, `f` for Favourites, `t` for Thinking level, `l` for Labels, `c` for Spec — the OpenSpec explore/spec/apply/review/archive flow). Auto-discovers extension commands and merges them with built-in actions. In session actions, `Shift+key` runs the tab/window variant when available.

Includes sub-modules:
- **Model Switcher** — searchable provider → model → thinking level picker
- **Favourite Models** — quick-switch to preset model+thinking combos via `favourite-models.json`
- **Thinking Picker** — adjust reasoning effort (off, minimal, low, medium, high, xhigh)
- **Session / Label Actions** — rename, archive, label, and jump between sessions

#### OpenSpec workflow

Press `Ctrl+X`, then `c` to open the Spec group:

| Key | Action | Command |
|---|---|---|
| `e` | Explore before proposing | `/opsx-explore` |
| `s` | Create a proposal, specs, and tasks | `/opsx-propose` |
| `a` | Implement a change interactively | `/opsx-apply` |
| `r` | Run the multi-angle review taskflow | `/tf:openspec-review` |
| `x` | Sync specs and archive a change | `/opsx-archive` |

OpenSpec prompts and skills are project-local. Initialize each project that uses the workflow:

```bash
openspec init --tools pi
```

The review command also needs the taskflow engine and the bundled review flow:

```bash
pi install npm:pi-taskflow
npm --prefix ~/.pi/agent/git/github.com/iurysza/pi-ext run flows:install
```

Run `/reload` after setup. Explore follows the conversation language. Final review reports use the session language when available and default to English; paths, identifiers, commands, and `VERDICT:` remain unchanged.

### [Custom Footer](extensions/custom-footer/)

Replaces Pi's default footer with a compact powerline-style status bar:

```
~/project (main) │ ↑12k ↓8k $0.42 │ 42%/200k │ ◷ ended 3:59 pm · 1m 50s ago │ ⚡ claude-sonnet-4 • medium
```

Shows working directory, git branch, token usage, cost, context window utilization, live time since the last response ended, and active model — all in a single line.

### [Tool Pills](extensions/tool-pills/)

Compact colored pill labels for built-in tools (`ls`, `read`, `find`, `grep`, `bash`) with collapsed output, plus Shiki-powered syntax-highlighted diffs for `write` and `edit`. Makes long tool outputs scannable without losing detail on demand.

### [Code Review](extensions/review/)

`/review` command with multiple modes: review a GitHub PR (checks it out locally), diff against a base branch, review uncommitted changes, review a specific commit, or provide custom review instructions. Supports project-specific `REVIEW_GUIDELINES.md`.

When `pi-sem` is also loaded, `/review` nudges the agent toward a semantic workflow:
- `sem_diff` for a one-shot overview of changed entities
- `sem_impact` for blast radius / affected tests on risky entities
- `sem_context` for focused understanding of suspicious functions or classes
- raw `git diff` / `read` for final line-level evidence

Derived from [mitsuhiko/agent-stuff](https://github.com/mitsuhiko/agent-stuff) (Apache 2.0).

### [pi-sem](extensions/pi-sem/)

Semantic git tooling powered by [sem](https://github.com/Ataraxy-Labs/sem). Exposes entity-aware tools — `sem_diff`, `sem_impact`, `sem_context`, `sem_log`, `sem_entities`, `sem_blame`, and `sem_eval` — so the agent can reason about functions, classes, and config properties instead of raw line hunks.

Includes a local evaluator to compare `sem diff` vs `git diff` on the same selection:

```bash
npm run sem:evaluate -- --staged
npm run sem:evaluate -- --from origin/main --to HEAD
```

### [Pi-Telescope](extensions/pi-telescope/)

Native TUI fuzzy finder, inspired by telescope.nvim and [Television](https://github.com/alexpasmantier/television). Fuzzy search with pattern modifiers (`'exact`, `^prefix`, `suffix$`, `!negate`), multi-select, provider switching, preview toggle, frecency-aware sorting, and provider-specific actions. Bound to `Ctrl+Space` by default.

### [Session Snap](extensions/session-snap/)

Session archiver and cleaner. `/snap` scans all sessions, classifies them (delete trivial ones, archive old ones, keep active ones), and lets you review before executing. `/archive` browses archived sessions with search, restore, and permanent delete.

### [Session Query](extensions/session-query/)

Gives the model a tool to query previous pi sessions for context, decisions, or code changes. Uses an uncapped VCC summary (~9K tokens) by default, with optional `detailed: true` mode (~80K tokens) for queries that need exact file contents or tool output. Works with the handoff extension to let a new session look up details from its parent.

### [Handoff](extensions/handoff/)

`/handoff [--tab] <goal>` transfers context to a fresh pi session in a tmux/cmux split by default, or a new tab/window with `--tab`. Uses pi-vcc's algorithmic compaction (no LLM calls) to build a summary, plus algorithmic extraction of git state, working files, and language detection. Includes current tasks from pi-tasks. The new session starts with the summary + goal as its initial prompt.

### [Permissions](extensions/permissions/)

Three-mode permission system: `yolo` (everything allowed), `safe` (rule-based checks, asks for unknown bash commands), `read-only` (no repo/home writes, built-in edits restricted to `/tmp`, bash restricted to safe read-only commands). `/mode [yolo|safe|read-only]` to switch. Rules merge project (`.agents/permissions.json`) → global (`~/.pi/agent/permissions.json`) → built-ins.

### [cmux](extensions/cmux/)

Native integration with [cmux](https://github.com/badlogic/cmux). Context-aware notifications via the cmux socket API, sidebar status pills (model, state, thinking, tokens), and custom tools for the model (browser, workspace, notify). `/split-fork [--tab]` works in tmux or cmux; other cmux features stay silent when not running inside cmux.

### [Superconductor](extensions/superconductor/)

Native integration with [Superconductor](https://superconductor.dev) via the `sc` CLI. Footer pill with the Superconductor-owned target branch and diff size, a `superconductor_worktree` tool for the model (status, diff, target branch, list/create worktrees), and commands (`/sc-fork`, `/sc-worktree`). Silent no-op when not running inside Superconductor.

### [Ask User Question](extensions/ask-user-question/)

Registers an `ask_user_question` tool the model uses to ask 1–4 structured clarifying questions (with 2–4 options each) instead of asking in plain text. Interactive UI with optional multi-select and short header labels for a tab bar.

## Skills

| Skill | Description |
|-------|-------------|
| [commit](skills/commit/) | Conventional Commits-style `git commit` — infers type, scope, and summary from the diff |
| [github](skills/github/) | Recipes for the `gh` CLI — PR checks, CI runs, issue queries, JSON output |
| [sem](skills/sem/) | Entity-aware change analysis workflow — prefer `sem_context` and `sem_impact`, use `sem_diff` selectively for summaries and reviews |
| [session-query](skills/session-query/) | Guide for querying past pi sessions via the `session-query` tool |
| [visit-webpage](skills/visit-webpage/) | Fetch and extract content from a URL as markdown (via Jina Reader), or download images |
| [web-search](skills/web-search/) | Lightweight web search via the Jina Search API — no browser required |

## Themes

| Theme | Description |
|-------|-------------|
| [catppuccin-mocha](themes/catppuccin-mocha.json) | Dark theme based on [Catppuccin Mocha](https://github.com/catppuccin/catppuccin) |

## Configuration

Most extensions work out of the box. Notable config:

- **Leader Key** — Scoped Models follows Pi's ordered `enabledModels`; optionally map exact entries to display roles in `extensions/leader-key/model-nicknames.json`
- **Permissions** — edit `~/.pi/agent/permissions.json` (global) or `.agents/permissions.json` (project) to add bash rules; use `/mode` to switch modes
- **pi-sem** — `npm install` should fetch the optional `@ataraxy-labs/sem` wrapper automatically; otherwise install `sem` globally with Homebrew or Cargo

## License

[MIT](LICENSE) © 2025 tomsej, © 2026 Iury Souza. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for component attribution.
