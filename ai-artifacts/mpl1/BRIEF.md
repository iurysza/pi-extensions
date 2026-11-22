# mpl1: Pi charting tool on mpljs

Iury wants the setup from Dillon Mulroy's post (see reference-tweet.png): a Pi tool `mpl_render`, called from codemode (`await tools.mpl_render({...})`), that renders charts with mpljs (https://github.com/ivarvong/mpl, matplotlib 3.11.2 port in pure TS, zero deps, v0.1.0, not on npm; last commit 689ebd4, needs Node 24+ to build).

## Tool shape (from the post)
Input: `{ name, rc: {"figure.figsize":[9,4.2]}, grid: {rows, cols, width_ratios}, ops: [[method, args[], kwargs?], ...] }`. Ops replay matplotlib Axes calls (fill_between, plot, axhline, axvline, barh, legend, set_title, grid, invert_yaxis...) with `["sca",[i]]` to switch axes and helpers like `{$dates: [...]}` / `{$date: "..."}` and `["$concise_x",[]]` for date axes. Returns `{ image, pngPath, width, height }` or `{ error }`, so codemode can `image(r.image)`. Optional style/theme (pro-slate, pro-dark...).

## Where
New package in this pi-extensions worktree (or inside pi-ext if that fits better: decide and say why). Follow repo conventions and the prebundle setup. Read Pi docs on extensions and codemode first (paths in the Pi system prompt docs section).

## Done means
- Tool registered, renders the latency-dashboard example from the post to PNG, and an error case returns `{error}` cleanly.
- Tests pass, repo checks pass.
- An agents2 pin plan for mpljs (git pin at a commit, build script allowed) written down, not applied.
- Report to Iury in Inbox thread "Pi Chart Tool" with the rendered PNG inline.

## Autonomy
I pre-approve local edits, builds, tests and commits in the assigned worktree and on its branch. Do not ask for these. This grant overrides the global rule to wait for confirmation for this local work only.
Ask before pushing, opening a PR or merging to main.
Ask before applying to the live home with `agents2 apply` against `~`.
Ask before changing anything outside the worktree.
Ask before any external action, including messages, payments and posting.
Models: workers claude-code/claude-sonnet-5-5:high. Don't run memo. Report to t11f with hc send when done or blocked.
