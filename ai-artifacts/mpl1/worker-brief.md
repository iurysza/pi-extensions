# Worker brief: mpl_render Pi tool (mpl1)

Read first: `ai-artifacts/mpl1/BRIEF.md`, the image `ai-artifacts/mpl1/reference-tweet.png`, repo `AGENTS.md`,
Pi docs `~/.local/share/agents2/tools/pi/1.5.2/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md`
(see "Structured output": `outputSchema` + `structuredContent`, `isError: true` for failures that carry data) and `docs/codemode.md`.
Model a small package on `packages/pi-wtf` (package.json, tsconfig, tests layout).

## Goal
New package `packages/pi-mpl-chart` (name `@iurysza/pi-mpl-chart`) registering a Pi tool `mpl_render` that renders charts with
mpljs (https://github.com/ivarvong/mpl, commit 689ebd4, package name `mpl`, not on npm). Codemode calls
`await tools.mpl_render({...})` and gets back a structured object.

### Input
`{ name, style?, rc?, grid?: {rows, cols, width_ratios?, height_ratios?, sharex?, sharey?}, ops: [[method, args[], kwargs?], ...], scale?, dpi? }`
- `style` default `"pro-slate"` (also pro-dark, pro-mono, pro-ember, and matplotlib bundled styles mpljs supports).
- Ops replay Axes method calls on the current axes. `["sca",[i]]` switches current axes (flat index).
  `["$concise_x",[]]` / `["$concise_y",[]]` apply a concise date locator+formatter to that axis.
  Allow a few figure-level ops if cheap (`suptitle`, `tight_layout`); tight_layout always runs before render.
- Arg helpers, resolved recursively: `{$dates: [isoStrings]}` → date values mpljs date axes accept; `{$date: "iso"}` → one.
- Only whitelisted-safe calls: method must exist on the Axes object and not start with `_`; reject `constructor`, `__proto__` etc.
- Import mpljs lazily (dynamic import inside execute) so the extension adds ~nothing to Pi startup.

### Output
Success: `{ image: "data:image/png;base64,...", pngPath, width, height }` where pngPath is written under
`os.tmpdir()/pi-mpl/<safe-name>-<timestamp>.png`. `content` for the model: short text + the image block.
Failure (bad method, mpljs throw, bad args): return `structuredContent: { error: "op 3 'plott': unknown Axes method" }` with
`isError: true`, never throw out of execute. Error text names the op index and method.
Keep `image` so codemode can do `image(r.image)`.

## The mpljs dependency (important)
Pi runs on Node 22.23.4 (`~/.volta/tools/image/node/22.23.4/bin/node`); mpljs says Node 24+ to build
(its `prepare` runs `node scripts/build_package.ts`). Node 26 is at `/opt/homebrew/bin/node`.
1. Try a git dependency `"mpl": "github:ivarvong/mpl#689ebd4"` (full sha preferred) in the package and root lockfile.
   Check: does `npm ci` at the repo root (Node 22, the volta default) build it? Does the built `dist/browser` load on Node 22?
   Root `allowScripts` may need an entry; follow the existing pattern.
2. If the build needs Node 24+, pick the simplest robust option and justify it in the report (e.g. vendor the built
   `dist/browser` under `packages/pi-mpl-chart/vendor/mpl/` with its LICENSE/notices, built from 689ebd4 with Node 26, plus a
   `scripts/vendor-mpl.sh` to rebuild). Preserve ISC license and THIRD_PARTY_NOTICES (repo rule).
Fonts: register the Inter/DejaVu font modules mpljs needs so text renders.

## Wire-up
- Add the extension to the root `package.json` `pi` catalog (see `scripts/check-catalog.mjs`). Prebundle: not needed (lazy import); say so.
- README for the package with the latency-dashboard example.

## Tests (node --test, like pi-wtf)
- Renders the latency-dashboard example from the tweet (code below) to a valid PNG (check PNG signature, width/height > 0).
  Save a copy to `ai-artifacts/mpl1/latency-dashboard.png` (also render a pro-dark variant `latency-dashboard-dark.png`).
- Error case: unknown method returns `{error}` + isError, no throw. Also a bad `$date`.
- Unsafe method name (`__proto__`, `constructor`) rejected.

Example ops (from the tweet):
```js
const days = Array.from({ length: 30 }, (_, i) => `2026-10-${String(i + 1).padStart(2, "0")}`);
let s = 7; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
const p50 = days.map((_, i) => 42 + 6 * Math.sin(i / 4) + rnd() * 4);
const p95 = p50.map((v) => v * 1.9 + rnd() * 10);
const p99 = p95.map((v, i) => v * 1.4 + (i === 18 ? 90 : rnd() * 15));
const services = ["api", "auth", "db", "cache", "queue"];
await tools.mpl_render({ name: "latency-dashboard", rc: { "figure.figsize": [9, 4.2] },
  grid: { rows: 1, cols: 2, width_ratios: [2.2, 1] },
  ops: [
    ["fill_between", [{ $dates: days }, p50, p95], { alpha: 0.18, color: "C0", lw: 0 }],
    ["plot", [{ $dates: days }, p50], { label: "p50" }],
    ["plot", [{ $dates: days }, p95], { label: "p95" }],
    ["plot", [{ $dates: days }, p99], { label: "p99", color: "#f5a97f" }],
    ["axhline", [250], { color: "#ed8796", ls: "--", lw: 1, label: "SLO" }],
    ["axvline", [{ $date: "2026-10-19" }], { color: "#eed49f", lw: 0.8, alpha: 0.6 }],
    ["$concise_x", []], ["set_ylabel", ["ms"]], ["set_title", ["Request latency, October"]],
    ["legend", [], { loc: "upper left", ncols: 4 }], ["set_ylim", [0, 300]],
    ["sca", [1]],
    ["barh", [services, [118, 64, 210, 12, 87]], { color: ["C0", "C1", "C4", "C2", "C3"], height: 0.6 }],
    ["invert_yaxis", []], ["grid", [false], { axis: "y" }], ["grid", [true], { axis: "x" }],
    ["set_xlabel", ["p95 ms"]], ["set_title", ["By service"]],
  ] });
```
Look at the PNG yourself (read tool) and make sure it looks right: dates on x, legend, SLO line, bars.
If an mpljs kwarg alias (lw, ls, ncols) isn't supported, map it or report it.

## Live check
Prove it works inside a real Pi: e.g. `pi -e ./packages/pi-mpl-chart/src/index.ts -p` (or similar non-interactive mode, see
Pi README) asking it to run the codemode example. Report what you ran and the result.

## Rules
- Own only `packages/pi-mpl-chart/**`, root `package.json`/`package-lock.json`, and `ai-artifacts/mpl1/*.png`. Touch nothing else.
- Pre-approved: local edits, installs, builds, tests in this worktree. Nothing outside the worktree. No push. **Do not commit** (lead commits).
- Before reporting run `npm ci` then `npm run check` at the root; report results honestly, with failures.
- You are a subagent. Don't run memo.
- Report with `hc send t12x "<summary>"` when done or stuck: dependency decision and why, files, test results, check results, live check, PNG paths, open issues.
