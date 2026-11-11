// The development-checkout git hooks: installed only where asked, quiet, and never able to fail git.
// Every case runs in a throwaway repository. Nothing is installed in this checkout.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { HOOK, HOOKS, PACKAGE_NAME, installHooks, removeHooks } from "../../scripts/install-bundle-hooks.mjs";

// The installer asks git for the hooks folder. Ignore the user's git config so a global
// core.hooksPath can never send a test's hooks outside its throwaway repository.
process.env.GIT_CONFIG_GLOBAL = "/dev/null";
process.env.GIT_CONFIG_SYSTEM = "/dev/null";

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" } });

/**
 * A repository that looks like this one (build script, root package name) with one commit,
 * esbuild "installed", and a fake npm that records its call and then fails.
 */
function repo(t, name = PACKAGE_NAME) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "bundle-hooks-")));
  const root = join(base, "repo");
  const bin = join(base, "bin");

  t.after(() => rmSync(base, { recursive: true, force: true }));
  for (const dir of [join(root, "node_modules/esbuild"), join(root, "scripts"), bin]) mkdirSync(dir, { recursive: true });
  writeFileSync(join(root, "scripts/build-bundles.mjs"), "");
  writeFileSync(join(root, "package.json"), `${JSON.stringify({ name, private: true }, null, 2)}\n`);
  writeFileSync(join(bin, "npm"), `#!/bin/sh\necho "$PWD|$*" >> "${base}/npm-calls"\necho build noise\nexit 7\n`);
  chmodSync(join(bin, "npm"), 0o755);
  git(root, "init", "-q", "-b", "main");
  writeFileSync(join(root, ".gitignore"), "node_modules/\n");
  git(root, "add", ".gitignore");
  git(root, "-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "-m", "one");

  return { base, root, calls: join(base, "npm-calls"), env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" } };
}

async function waitFor(file) {
  for (let i = 0; i < 100 && !existsSync(file); i++) await new Promise(done => setTimeout(done, 50));

  return existsSync(file);
}

test("install writes both hooks, is repeatable, and remove takes only its own files", t => {
  const { root } = repo(t);
  const files = installHooks(root);

  assert.deepEqual(files, HOOKS.map(name => join(root, ".git/hooks", name)));
  for (const file of files) {
    assert.equal(readFileSync(file, "utf8"), HOOK);
    assert.equal(statSync(file).mode & 0o111, 0o111);
  }
  assert.deepEqual(installHooks(root), files);
  assert.deepEqual(removeHooks(root), files);
  assert.deepEqual(removeHooks(root), []);
});

test("install refuses to replace a hook it did not write, and writes nothing", t => {
  const { root } = repo(t);
  const foreign = join(root, ".git/hooks/post-merge");

  mkdirSync(join(root, ".git/hooks"), { recursive: true });
  writeFileSync(foreign, "#!/bin/sh\necho mine\n");
  assert.throws(() => installHooks(root), /not replacing existing hook/);
  assert.equal(readFileSync(foreign, "utf8"), "#!/bin/sh\necho mine\n");
  assert.equal(existsSync(join(root, ".git/hooks/post-checkout")), false);
  assert.deepEqual(removeHooks(root), []);
});

test("a branch switch runs the build once, prints nothing, and a failed build does not fail git", async t => {
  const { root, calls, env } = repo(t);

  installHooks(root);

  const run = spawnSync("git", ["checkout", "-q", "-b", "other"], { cwd: root, env, encoding: "utf8" });

  assert.equal(run.status, 0);
  assert.equal(run.stdout + run.stderr, "");
  assert.equal(await waitFor(calls), true);
  assert.equal(readFileSync(calls, "utf8"), `${root}|run --silent build:bundles\n`);
  assert.equal(readFileSync(join(root, ".git/prebundle-hook.log"), "utf8"), "build noise\n");
});

test("the hook does nothing for a file checkout, without dependencies, or in a linked worktree", async t => {
  const { base, root, calls, env } = repo(t);

  installHooks(root);

  // A file checkout (flag 0) is not a branch switch.
  writeFileSync(join(root, ".gitignore"), "changed\n");
  assert.equal(spawnSync("git", ["checkout", "-q", "--", ".gitignore"], { cwd: root, env }).status, 0);

  // A linked worktree shares the hooks but has its own tree; the hook leaves it alone.
  const linked = join(base, "linked");

  assert.equal(spawnSync("git", ["worktree", "add", "-q", "-b", "wt", linked], { cwd: root, env }).status, 0);
  mkdirSync(join(linked, "node_modules/esbuild"), { recursive: true });
  assert.equal(spawnSync("git", ["checkout", "-q", "-b", "wt2"], { cwd: linked, env }).status, 0);

  // No esbuild means no dependencies: nothing to build with.
  rmSync(join(root, "node_modules"), { recursive: true });
  assert.equal(spawnSync("git", ["checkout", "-q", "-b", "other"], { cwd: root, env }).status, 0);

  await new Promise(done => setTimeout(done, 500));
  assert.equal(existsSync(calls), false);
});

test("install refuses when core.hooksPath is set, and writes nothing", t => {
  const { base, root } = repo(t);
  const shared = join(base, "shared-hooks");

  mkdirSync(shared);
  git(root, "config", "core.hooksPath", shared);
  assert.throws(() => installHooks(root), /core\.hooksPath is set to .*shared-hooks.*nothing was installed/);
  assert.deepEqual(readdirSync(shared), []);
  assert.equal(HOOKS.some(name => existsSync(join(root, ".git/hooks", name))), false);
});

test("the hook does nothing in a repository that is not this one", async t => {
  // Same hook file, as if a shared hooks folder had carried it into other repositories.
  const other = repo(t, "some-other-package");
  const noScript = repo(t);

  rmSync(join(noScript.root, "scripts/build-bundles.mjs"));

  for (const { root, env } of [other, noScript]) {
    for (const name of HOOKS) {
      mkdirSync(join(root, ".git/hooks"), { recursive: true });
      writeFileSync(join(root, ".git/hooks", name), HOOK, { mode: 0o755 });
    }

    const run = spawnSync("git", ["checkout", "-q", "-b", "other"], { cwd: root, env, encoding: "utf8" });

    assert.equal(run.status, 0);
    assert.equal(run.stdout + run.stderr, "");
  }

  await new Promise(done => setTimeout(done, 500));
  assert.equal(existsSync(other.calls), false);
  assert.equal(existsSync(noScript.calls), false);
});
