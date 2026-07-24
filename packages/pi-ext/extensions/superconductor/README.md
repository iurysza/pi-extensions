# Superconductor

Native [Superconductor](https://superconductor.dev) integration for pi.

Superconductor launches pi inside managed git worktrees and terminal sessions, and exposes its state through the `sc` CLI (backed by a local API socket). This extension surfaces that integration directly inside pi so the agent — and you — can work with Superconductor without leaving the session.

Inspired by the [cmux extension](../cmux/) and projects like [pi-cmux](https://github.com/javiermolinar/pi-cmux). Where cmux speaks a raw Unix-socket protocol, Superconductor is driven entirely through the `sc` CLI, so this extension shells out to `sc ... --json` and parses the structured envelope.

If pi is not running inside Superconductor, the extension is a silent no-op.

## What you get

### Status pill

A footer status pill shows the Superconductor-owned **target branch** and the current diff size:

```
SC →main · 6f +639 -0
```

It refreshes on session start and after each agent run. This is additive — it never overwrites the Superconductor tab title. Set `PI_SC_TAB_TITLE=1` to also drive the tab title with a running/idle indicator.

### Tools for the model

| Tool | Actions |
|------|---------|
| `superconductor_worktree` | `status`, `diff_summary`, `set_target_branch`, `rename_branch`, `list_worktrees`, `create` |

- **Worktree** lets the model read the authoritative target/base branch (it is Superconductor-owned — never inferred from git defaults), inspect the diff, list git worktrees, and **create new worktrees**.

  > **Creating worktrees.** Superconductor's local API (v17) exposes no command to create a managed worktree — SC builds those inside the app. So `create` (and the `/sc-worktree` command) fall back to **raw `git worktree add`** against the root repo (`SUPERCONDUCTOR_ROOT_PATH`), branching off `base` (default `main`). The result is a real git worktree on disk; with `open_in_sc` (the command always tries) it is surfaced via `sc workspace open`, but it is **not** registered as a Superconductor-managed task.

### Commands

- `/sc-fork [prompt]` — fork the current session into a new session file and open a fresh Superconductor terminal split. Superconductor terminal panes have no documented "send text" RPC, so the command opens the split and hands you a ready-to-paste `pi --session <file>` command.
- `/sc-worktree <branch> [base]` — create a git worktree off `base` (default `main`) on `branch`, then open it in Superconductor via `sc workspace open`. See the worktree-creation caveat above.

## Configuration

| Env var | Effect |
|---------|--------|
| `PI_SC_DISABLE=1` | Disable the extension entirely |
| `PI_SC_TAB_TITLE=1` | Drive the Superconductor tab title with running/idle state |
| `PI_SC_VERBOSE=1` | Log every `sc` invocation to stderr |
| `SUPERCONDUCTOR_SC_BIN` | Override the `sc` binary path (default: `sc` on PATH) |

Detection uses `SUPERCONDUCTOR_MANAGED_AGENT=1` or the presence of `SUPERCONDUCTOR_LOCAL_API_SOCKET`.

## Notes

- All `sc` calls run with the worktree (`SUPERCONDUCTOR_WORKTREE_PATH`) as the working directory.
- `sc` envelopes come in two shapes: most commands wrap the payload in `response`, a few put it at the top level. Errors arrive as `{ "kind": "cli_error", "error": { "code", "message" } }`. The client normalizes all three.
