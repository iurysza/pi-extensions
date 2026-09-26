# File-search implementation handoff

## Result

Implemented the approved clean-room `fd`/`rg` Pi extension in the canonical `pi-extensions` repository. No commit or push was made for this work. The agents repository and installed Pi configuration were not modified.

The extension now:

- registers strict typed `fd` and `rg` tools without probing or downloading during factory load;
- normalizes leading `@` and `~` paths, resolves relative paths from Pi's cwd, uses argv without a shell, and places patterns after `--`;
- supports the approved fd/rg option surfaces, ignore-aware defaults, smart case, literal search, and visible parameter bounds;
- resolves `fd`, then `fdfind`, and `rg` independently before checking each managed fallback;
- respects `PI_OFFLINE=1` and never invokes installation after usable system/fallback resolution;
- securely installs pinned official macOS/Linux arm64/x64 archives with HTTPS-only redirects, redirect/byte/time bounds, incremental SHA-256, exact-member extraction, `0755`, post-install probing, and atomic replacement under `${PI_CODING_AGENT_DIR:-~/.pi/agent}/bin`;
- streams stdout to a private spill file while retaining at most 2,000 lines/50,000 bytes, bounds stderr at 64 KiB, removes ordinary/error/cancelled/timeout spill output, and retains complete output only for truncated success;
- terminates process groups on cancellation/timeout and clears delayed kill escalation after process settlement;
- classifies rg exit 1/no output as no matches and labels setup/execution errors with the affected tool;
- provides prompt guidance and compact/expanded TUI rendering for progress, no matches, counts, errors, and truncation;
- warms both resolvers independently at `session_start`, stays silent for system/fallback binaries, reports fresh installs, and reports each setup failure without disabling its sibling.

## Changed files

- `package.json` — adds file-search to the root Pi resource union.
- `packages/pi-ext/package.json` — exports the extension and includes its tests.
- `packages/pi-ext/README.md` — concise operation/offline note.
- `packages/pi-ext/extensions/file-search/index.ts`
- `packages/pi-ext/extensions/file-search/src/args.ts`
- `packages/pi-ext/extensions/file-search/src/binaries.ts`
- `packages/pi-ext/extensions/file-search/src/limits.ts`
- `packages/pi-ext/extensions/file-search/src/output.ts`
- `packages/pi-ext/extensions/file-search/src/process.ts`
- `packages/pi-ext/extensions/file-search/src/prompt.ts`
- `packages/pi-ext/extensions/file-search/src/search.ts`
- `packages/pi-ext/tests/file-search/file-search.test.mjs`
- `packages/pi-ext/tests/file-search/process.test.mjs`

This handoff file is also new. No runtime dependency or lockfile changed.

Concurrent repository note: pre-existing startup-screen work was committed and pushed as `a2c9d38` while this implementation was in progress. The final file-search diff is based on that current `main`, did not overwrite it, and `git status` now shows only the file-search manifest/docs/source/test changes plus this handoff artifact.

## Release receipts

Receipts were collected from official GitHub release APIs and downloaded official HTTPS assets. All archives were locally hashed with `shasum -a 256`. Ripgrep hashes were also compared successfully with each official `.sha256` sidecar. The largest observed archive is 2,265,718 bytes, so the 25 MiB cap is an ample tripwire.

| Tool/target | Official asset | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| fd 10.4.2 darwin arm64 | `https://github.com/sharkdp/fd/releases/download/v10.4.2/fd-v10.4.2-aarch64-apple-darwin.tar.gz` | 1,328,933 | `623dc0afc81b92e4d4606b380d7bc91916ba7b97814263e554d50923a39e480a` |
| fd 10.3.0 darwin x64 | `https://github.com/sharkdp/fd/releases/download/v10.3.0/fd-v10.3.0-x86_64-apple-darwin.tar.gz` | 1,430,203 | `50d30f13fe3d5914b14c4fff5abcbd4d0cdab4b855970a6956f4f006c17117a3` |
| fd 10.4.2 linux arm64 | `https://github.com/sharkdp/fd/releases/download/v10.4.2/fd-v10.4.2-aarch64-unknown-linux-gnu.tar.gz` | 1,559,490 | `6c51f7c5446b3338b1e401ff15dc194c590bb2fa64fd43ff3278300f073adec5` |
| fd 10.4.2 linux x64 | `https://github.com/sharkdp/fd/releases/download/v10.4.2/fd-v10.4.2-x86_64-unknown-linux-gnu.tar.gz` | 1,700,779 | `def59805cd14b5651b68990855f426ad087f3b96881296d963910431ba3143c8` |
| rg 15.2.0 darwin arm64 | `https://github.com/BurntSushi/ripgrep/releases/download/15.2.0/ripgrep-15.2.0-aarch64-apple-darwin.tar.gz` | 1,764,284 | `3750b2e93f37e0c692657da574d7019a101c0084da05a790c83fd335bad973e4` |
| rg 15.2.0 darwin x64 | `https://github.com/BurntSushi/ripgrep/releases/download/15.2.0/ripgrep-15.2.0-x86_64-apple-darwin.tar.gz` | 1,878,284 | `af7825fcc69a2afc7a7aea55fc9af90e26421d8f20fe59df32e233c0b8a231c1` |
| rg 15.2.0 linux arm64 | `https://github.com/BurntSushi/ripgrep/releases/download/15.2.0/ripgrep-15.2.0-aarch64-unknown-linux-gnu.tar.gz` | 1,854,661 | `a740b91c82eaf9914cfedd353572f2791cbe0162c84101ee0951058f4dcbc90d` |
| rg 15.2.0 linux x64 | `https://github.com/BurntSushi/ripgrep/releases/download/15.2.0/ripgrep-15.2.0-x86_64-unknown-linux-musl.tar.gz` | 2,265,718 | `33e15bcf1624b25cdd2a55813a47a2f95dbe126268203e76aa6a585d1e7b149c` |

GitHub API commands used:

```sh
gh api repos/sharkdp/fd/releases/tags/v10.4.2
gh api repos/sharkdp/fd/releases/tags/v10.3.0
gh api repos/BurntSushi/ripgrep/releases/tags/15.2.0
```

## Validation

Passed:

- `node --test packages/pi-ext/tests/file-search/*.test.mjs` — exit 0; 21 tests, 6 suites.
- `npm run typecheck --workspace @iurysza/pi-ext` — exit 0.
- `npm test --workspace @iurysza/pi-ext` — exit 0; package suite passed, including 49 native package tests and 214 tool-presentation tests.
- `npm run pack:check --workspace @iurysza/pi-ext` — exit 0; 123 files, 236,545 bytes at that run.
- `npm run check:catalog` — exit 0; 10 packages.
- `npm run check` — exit 0; full monorepo typecheck, tests, catalog, and 10 pack checks passed. The final small boundary-error wrapper/test delta was then covered by the final focused test and typecheck commands above.
- `git diff --check` — exit 0.
- Official Pi loader smoke in the focused suite loaded the real extension with `PI_OFFLINE=1`, registered exactly `fd` and `rg`, and reported no loader error or factory-time setup side effect.

The focused tests cover argv safety/options/bounds, path normalization, release matrix, independent/offline resolution, caching, notification policy, HTTPS/redirect/size/timeout/hash failures, extraction/probe/mode/atomic replacement, preview limits/UTF-8, stdout spill retention/cleanup, bounded stderr, exit classification, cancellation, timeout, render states, boundary errors, and official loader registration. Network behavior uses injected fake transports; tests make no real network calls.

Live system-binary fixture through `searchWithBinary` also passed:

- default `fd` returned only `visible.ts`, excluding `.hidden/secret.ts` and gitignored `ignored/skip.ts`;
- `hidden=true` added `.hidden/secret.ts` while the ignored file stayed excluded;
- literal rg search for `[value]` with one context line returned the intended line/context;
- absent rg pattern returned `no-matches`;
- a 900-line/160,882-byte rg result truncated its preview and retained a complete spill path.

## Manual scope review

- Implementation was written clean-room from the approved behavioral contract. No unlicensed upstream source was copied.
- Diff stays in the pi-ext manifests, package README, new extension, new tests, and this handoff.
- No agents repo, installed Pi state, OpenCode/Codex config, dotfiles, shell aliases, package-manager ownership, or built-in `find`/`grep` implementation changed.

## Remaining promotion work

The extension implementation itself is complete. The parent/new promotion agent still needs to:

1. review this diff against the goal and current `main`;
2. commit and push the `pi-extensions` changes without including unrelated artifacts unless desired;
3. update the agents repo to consume the published pi-ext revision/release and expose `fd`/`rg` to the intended personal/work Pi profiles and only roles already carrying both `find` and `grep`;
4. render/check both profiles, apply personal on this Mac, and run offline doctor/live checks;
5. append final promotion, apply, and release evidence to the goal dev log.

No product or architecture decision is blocking that promotion.
