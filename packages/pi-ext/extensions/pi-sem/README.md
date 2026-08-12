# pi-sem

Semantic Git tooling for Pi, powered by [`sem`](https://github.com/Ataraxy-Labs/sem).

The package keeps three focused entity-aware tools active. Use raw Git and file tools for diffs, history, blame, and line-level evidence.

## Active tools

- `sem_impact` - dependency / blast-radius analysis for an entity
- `sem_context` - token-budgeted semantic context for a focused entity
- `sem_entities` - structural inventory of a file

[`tool-trim`](../tool-trim/) deactivates `sem_diff`, `sem_eval`, `sem_log`, and `sem_blame` after the extension registers them.

## Installation notes

This repo declares `@ataraxy-labs/sem` as an optional dependency, so `npm install` should fetch the wrapper binary automatically on supported platforms.

Fallback options:

```bash
npm install @ataraxy-labs/sem
# or
brew install sem-cli
# or
cargo install --git https://github.com/Ataraxy-Labs/sem sem-cli
```

## Evaluation workflow

Run the local benchmark helper to compare semantic diff coverage and size versus raw git diff:

```bash
npm run sem:evaluate -- --staged
npm run sem:evaluate -- --from origin/main --to HEAD
npm run sem:evaluate -- --commit HEAD
```

Useful flags:

```bash
npm run sem:evaluate -- --staged --no-impact
npm run sem:evaluate -- --from origin/main --to HEAD --file-ext .ts --file-ext .md
npm run sem:evaluate -- --format json
```

## What to look at

The evaluator reports:

- **coverage** - how many git-changed files also show up in `sem diff`
- **payload size** - bytes / lines / rough token estimate for raw `git diff` vs `sem diff --format json`
- **semantic summary** - number of entities, change types, and top changed entities
- **impact samples** - sample `sem impact --tests` lookups for a few changed entities

Important: our first local runs showed that `sem diff --format json` is **not always smaller** than raw `git diff`, especially on very large or lockfile-heavy diffs. The upside is better entity structure and impact/context workflows, not guaranteed token compression on every selection.

## Suggested Pi usage

Good prompts once the extension is loaded:

- “What tests are affected by changes to `buildReport`? Use `sem_impact`.”
- “Give me focused context for `buildReport` with a 4000 token budget using `sem_context`."
- “List the entities in this file using `sem_entities`."

Recommended default posture:

- prefer **`sem_context`** for one suspicious function/class
- prefer **`sem_impact`** for blast radius and test selection
- use **`sem_entities`** to inventory a large file
- use **raw `git diff` and file reads** for exact change evidence

If the review extension is loaded too, `/review` now adds this semantic workflow directly into its review prompt.
