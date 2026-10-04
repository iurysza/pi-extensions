# tool-pills patch for @tintinweb/pi-subagents 0.19.0

Gives `get_subagent_result` and `steer_subagent` the same compact two-line "pill" that
`tool-presentation` draws for built-ins. `Agent` and `SubagentWorkflow` are untouched.

Without it, pi prints a raw args line plus the model-facing header (`Agent:/Type:/Status:/...`).

## What it changes

- Adds `src/ui/tool-pills.ts` (self-contained renderers, `renderShell: "self"`).
- Registers `renderCall`/`renderResult` on the two tools.
- Adds a small `details` object (`{ kind, agentId, status }`) to their results. Model-facing text is unchanged.
  Renderers fall back to parsing the text when `details` is missing (old sessions).
- Line 1 uses the `reasoning` arg when present (the harness passes it), else "get result" / "steer agent".

## Apply

```bash
./apply.sh            # apply to the installed package (idempotent)
./apply.sh --status   # applied | not applied
./apply.sh --revert
./apply.sh [--revert] /path/to/@tintinweb/pi-subagents   # other location
```

Then run `/reload` in pi. pi loads `src/index.ts` directly; `dist/` is not used and is left alone.

## After a package upgrade

The patch is pinned to 0.19.0. The installed copy lives under a versioned directory, so a new
version is a fresh, unpatched copy. Run `apply.sh <new-package-dir>`. If it reports the patch does
not apply cleanly, redo the edits by hand (see the patch; it is about 330 lines, mostly the new file) and
regenerate with `git diff --no-index`, then move it to a new version directory.

See `UPSTREAM.md` for the change worth proposing upstream.
