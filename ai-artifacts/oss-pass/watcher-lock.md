# Watcher startup lock

`ghost-state.sh` uses Node's non-recursive `fs.mkdirSync` to acquire `start.lock`. An existing directory must fail with EEXIST. Node is already required to launch the watcher and is resolved before lock acquisition. Missing Node still returns 127. Owner PID, stale-lock recovery, grace periods, and watcher identity checks are unchanged.

## Observed failure

[Diagnostic CI run 42042052012](https://github.com/iurysza/pi-extensions/actions/runs/42042052012) ran Ubuntu 26.04.1, image `ubuntu-26.04` version `20261101.186.1`, x64, Node 22.19.0.

1. Controllers 8444 and 8447 both entered the successful `mkdir start.lock` branch. Neither entered stale-lock reclamation.
2. Both wrote their owner PID and launched watchers 8496 and 8497.
3. Both watchers logged startup and successful layout processing. The shared PID file ended at 8497.
4. Later repeat, socket-alias, and alternate-script starts reused 8497. Both watchers remained alive when the unchanged two-versus-one log-count assertion failed.

[uutils/coreutils#13970](https://github.com/uutils/coreutils/issues/13970) documents the matching Ubuntu 26.04 defect: concurrent non-recursive `mkdir` can return success despite EEXIST. [Upstream fix bf423f3](https://github.com/uutils/coreutils/commit/bf423f388d54) restricts that success path to recursive creation. The CI trace did not capture the resolved binary or its version, so the exact installed implementation remains unverified.

## Regression and checks

The regression precreates a lock owned by the live test process. A temporary PATH shim makes non-recursive shell `mkdir` incorrectly succeed on that existing lock. The original controller starts a watcher and removes the owner's lock. The patched controller exhausts its normal bounded attempts, preserves the owner, and creates no watcher or requests. Setting the stale interval to zero shortens the test's attempt budget; it does not make a live owner stale. The existing concurrent-start test still requires exactly one watcher.

Verified locally:

- Regression against the original controller: fails with `Missing expected rejection`; diagnostics show exit 0 and a started watcher.
- `bash -n scripts/*.sh`: passes.
- Full ghost suite on macOS with Node 22.22.3: 17 tests pass.
- Full ghost suite on Debian 12 arm64 with Node 22.19.0 and npm 10.9.3: 17 tests pass. This matches CI's Node release, not its Ubuntu x64 image. Dependencies were mounted read-only from the host installation.
- Missing-Node check: exit 127, expected error message, and no acquired lock.
- `npm ci` followed by `npm run check`: both exit 0, including all 16 package checks. Install reports seven vulnerabilities: two moderate, four high, and one critical. Dependencies are unchanged.

Temporary xtrace is removed. Failure-only command outcomes, PID files, watcher logs, and process identities remain. Raw evidence is under `/tmp/oss-pass-pr31b/`.
