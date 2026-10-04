# tool-pills patch for @tintinweb/pi-subagents 0.19.0

Gives `get_subagent_result` and `steer_subagent` a compact two-line "pill" in the style of
`tool-presentation`. `Agent` and `SubagentWorkflow` are untouched. Rendering only: model-facing text is unchanged.

## Layout

The row background is the status (pending / success / error). There are no status words and no arrows.

```
󰚩 subagent · wait for result  Explore @Jack
{reasoning} · 58s · 15 tool calls · 37.9k tokens · 9% ctx
```

- Line 1: bold `subagent · {get result | wait for result | steer}`, then the role (hidden for `Agent` / `general-purpose`) and `@handle`
  as typed by the model (raw ids are shortened to 8 chars). A dim `· ` leads while the call is running.
- Line 2: dim reasoning (fallback `get result` / `wait for result` / `steer agent`), then the facts.
  Narrow widths cut the reasoning first, then drop trailing facts whole.
- Facts: done `58s · N tool calls · N tokens · N% ctx`; waiting `21s`; get on a running agent `still running · …`;
  steer `"message"` or `queued · "message"`; failures show only the reason (`no such agent`, `not running, already finished`,
  agent error text cut to 60 chars). Agent status `error`, `aborted`, `stopped` and all lookup failures use the red background.
- Expanded (ctrl-o): the original tool text exactly as returned (full `Agent:/Type:/…` header, blank line, result), dim, 2-space
  indent, capped at 200 lines. For steer, the full message is added only when line 2 truncated it.

Because these tools return plain text, pi never flags "not found" as an error. The renderer picks the background from the
additive `details` (`{ kind, agentId, status, type }`), and falls back to parsing the text for old sessions.

## Apply

```bash
./apply.sh            # idempotent; also upgrades the v1 patch (legacy/) in place
./apply.sh --status   # applied | not applied | outdated (exit 3) | unknown (exit 2)
./apply.sh --revert
./apply.sh [--revert|--status] /path/to/@tintinweb/pi-subagents
```

Then run `/reload` in pi. `apply.sh` is all-or-nothing: if the patch does not apply cleanly it changes nothing and exits 2.

## Regenerate

1. `apply.sh --revert` (pristine package), copy `src/` to a scratch git repo, commit it.
2. Edit there, then `git diff > tool-pills.patch` (paths `a/src/...`, `b/src/...`).
3. `apply.sh && apply.sh --status`.

## After a package upgrade

The patch is pinned to 0.19.0. Run `apply.sh <new-package-dir>`; if it fails, redo the edits and move the patch to a new version
directory. See `HOOK-PROPOSAL.md` for automatic re-apply and `UPSTREAM.md` for the upstream suggestion.
