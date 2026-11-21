# @iurysza/pi-mpl-chart

Pi tool `mpl_render`: render matplotlib-style charts to PNG with [mpljs](https://github.com/ivarvong/mpl) (pure TypeScript port of matplotlib, ISC licence).

The extension imports mpljs lazily on the first call, so it adds almost nothing to Pi startup. It needs no prebundle entry.

## Dependency

mpljs is not on npm and its git build needs Node 24+, so the built `dist/browser` is vendored at `vendor/mpl/` (commit 689ebd4383c0f55b4219e73303f0b1dea6660bbf; ISC licence and notices included; see `vendor/mpl/PROVENANCE.md`). Rebuild with `scripts/vendor-mpl.sh` (needs Node 24+, default `/opt/homebrew/bin/node`). The vendored build loads on Node 22.

## Call it

From codemode:

```js
const r = await tools.mpl_render({ name: "latency-dashboard", rc: { "figure.figsize": [9, 4.2] },
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
image(r.image);
```

The full runnable data setup is in `tests/example.mjs`. Rendered output: `ai-artifacts/mpl1/latency-dashboard.png` (and `-dark.png`).

## Input

`{ name, style?, rc?, grid?, ops, scale?, dpi? }`

- `style`: `pro-slate` (default), `pro-dark`, `pro-mono`, `pro-ember`, or a matplotlib style mpljs bundles.
- `grid`: `{ rows, cols, width_ratios?, height_ratios?, sharex?, sharey? }`. Ratios go to mpljs as `gridspec_kw`.
- `ops`: `[method, args[], kwargs?]`, replayed on the current Axes. `["sca",[i]]` switches Axes (flat index).
  `["$concise_x",[]]` / `["$concise_y",[]]` set a concise date locator and formatter. `suptitle` and `tight_layout` act on the figure. `tight_layout` always runs before rendering.
- `{ $dates: [iso...] }` and `{ $date: "iso" }` become UTC dates anywhere in args or kwargs.
- Methods starting with `_`, and names such as `constructor` or `__proto__`, are rejected. The method must exist on the Axes prototype.
- `scale` defaults to 2.

## Output

Success: `{ image: "data:image/png;base64,…", pngPath, width, height }`. The PNG is also written to `os.tmpdir()/pi-mpl/<name>-<timestamp>.png`. The model gets a short text plus an image block.

Failure: `{ error: "op 3 'plott': unknown Axes method" }` with `isError: true`. The tool never throws.

## Test

```sh
npm test -w @iurysza/pi-mpl-chart
```
