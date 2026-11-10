# Startup prebundle

Some extension entries load from a prebuilt bundle, so Pi starts faster. The bundle is used only when it matches the sources on disk. Otherwise the source loads, as before.

## What is bundled

Ten entries today. The list is `ENTRIES` in `scripts/build-bundles.mjs`.

| Package | Entries |
| --- | --- |
| `pi-cursor-sdk` | `pi-cursor-sdk` |
| `pi-cursor-cloud` | `pi-cursor-cloud` |
| `pi-token-tank` | `pi-token-tank` |
| `pi-ext` | `tool-presentation`, `leader-key`, `pi-telescope`, `compaction-model`, `session-snap`, `permissions`, `handoff` |

## How an entry loads

Each bundled entry is split in two files:

- `main.ts` holds the extension.
- `index.ts` is a small loader. Pi loads this path, so no manifest changes. For `permissions` the loader is `permissions.ts`, the path its manifest already names.

The loader calls `loadPrebundled` from `prebundle.ts`:

1. Read `packages/<pkg>/.prebundle/<slug>/manifest.json`.
2. Hash the source files the manifest lists.
3. If the hash matches, import `.prebundle/<slug>/index.ts`.
4. In every other case, import `./main.ts`.

"Every other case" means: no bundle, no manifest, an edited or deleted source file, a bundle that fails to import, or `PI_PREBUNDLE=0`.

`prebundle.ts` has one copy per package (`packages/pi-ext/extensions/shared/`, and `src/` in `pi-cursor-sdk`, `pi-cursor-cloud` and `pi-token-tank`), because the packages publish separately. A test keeps the copies identical.

## Building

```sh
npm run build:bundles                 # build; a failed entry is skipped with a warning
node scripts/build-bundles.mjs --strict   # exit 1 if any entry fails (CI)
node scripts/build-bundles.mjs --status   # fresh, stale or missing, per entry
```

Bundles are git-ignored and are not published to npm. Run the build after a pull or an edit to get the speed back. A stale bundle is never loaded, so skipping the build is safe; it is only slower.

The build uses esbuild: split ESM written as `.ts` files. Modules Pi provides and everything under `node_modules` stay external. `import.meta.url` is rewritten to a relative URL back to the original source file, so the tree can be moved after the build.

## Checks

`npm run check:bundles` runs a strict build and `tests/prebundle/`:

- The loader rule, on a fixture package: fresh, stale, missing, broken, switched off, moved.
- The lazy-import guard: `@cursor/sdk`, shiki and `rich-diff.ts` must not be reachable through static imports from a bundle entry.
- Each bundle registers the same tools, commands, shortcuts, renderers and events as its source.
- Shared modules: a bundle carries its own copy of each shared source file, as Pi already gives each extension its own copy. `tests/prebundle/identity.test.mjs` checks that `session-store/db.ts` keeps its shared state in the database file, not in module variables.

## Debugging

- `PI_PREBUNDLE=0` loads source everywhere.
- `PI_PREBUNDLE_DEBUG=1` prints one line per entry to stderr, with the reason a bundle was or was not used.

## Adding an entry

1. Move the entry's code to `main.ts` beside it.
2. Write the loader in the entry file. Copy an existing one and change the slug.
3. Add the entry to `ENTRIES`.
4. Point tests that import named exports at `main.ts`.
5. Run `npm run check`.
