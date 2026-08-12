---
name: sem
description: Entity-aware code analysis using the focused pi-sem tools. Use for compact context around one function or class, dependency and affected-test analysis, or a structural file inventory.
---

# sem

Use the focused `pi-sem` tools as a semantic lens. Use raw Git and file tools for diffs, history, blame, and line-level evidence.

## Choose the smallest tool

1. **Understand one entity** → `sem_context`
   - Use for a function, method, class, block, or config section.
   - Prefer this before reading a whole large file.

2. **Find blast radius or affected tests** → `sem_impact`
   - Use `scope=tests` for test selection.
   - Use `scope=all` for broader dependents and dependencies.

3. **Inventory a file** → `sem_entities`
   - Use before drilling into a large or mixed code/config file.

## Review workflow

1. Inspect the actual change with raw Git diff and file reads.
2. Identify the riskiest changed entities.
3. Run `sem_impact` on entities with possible cross-file effects.
4. Run `sem_context` where focused dependency-aware context helps.
5. Use `sem_entities` when a file's structure is unclear.
6. Confirm every finding against the changed code before citing lines.

## Caveats

- `sem` may under-cover tests, assets, generated files, or non-semantic glue code.
- Treat surprising impact results as leads, then verify them with file reads and search.
- Do not write review findings from semantic output alone.
