import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();

function read(relativePath: string): string {
  return readFileSync(join(root, relativePath), "utf8");
}

test("Pi manifest loads the standalone extension", () => {
  const manifest = JSON.parse(read("package.json")) as {
    name: string;
    pi: { extensions: string[] };
    files: string[];
  };

  assert.equal(manifest.name, "pi-ghost-in-the-machine");
  assert.deepEqual(manifest.pi.extensions, ["src/index.ts"]);
  for (const required of ["src", "scripts", "shaders", "herdr-plugin.toml", "ai-artifacts/docs", "assets"]) {
    assert.ok(manifest.files.includes(required), `missing package file entry: ${required}`);
  }
});

test("extension registers a direct command for every state", () => {
  const source = read("src/index.ts");
  for (const state of ["idle", "thinking", "working", "done", "error"]) {
    assert.match(source, new RegExp(`\\"${state}\\"`));
  }
  for (const command of ["ghost-status", "ghost-off", "ghost-disable", "ghost-on"]) {
    assert.match(source, new RegExp(`registerCommand\\(\\"${command}\\"`));
  }
  assert.match(source, /registerCommand\(`ghost-\$\{state\}`/);
});

test("generated shaders force the expected lifecycle states", () => {
  const states = {
    idle: 0,
    thinking: 1,
    working: 2,
    done: 3,
    error: 4,
  } as const;

  for (const [state, value] of Object.entries(states)) {
    const shader = read(`shaders/variants/${state}.glsl`);
    assert.match(shader, new RegExp(`const int FORCED_STATE = ${value};`));
    assert.doesNotMatch(shader, /const int FORCED_STATE = -1;/);
  }
});

test("controller uses stable state storage and Ghostty reload signal", () => {
  const controller = read("scripts/ghost-state.sh");
  assert.match(controller, /\.local\/state}\/ghost-in-the-machine/);
  assert.match(controller, /kill -USR2/);
  assert.match(controller, /shaders\/variants/);
});

test("controller writes a bundled shader path into the runtime fragment", () => {
  const stateHome = mkdtempSync(join(tmpdir(), "ghost-state-"));
  try {
    execFileSync("bash", [join(root, "scripts/ghost-state.sh"), "apply", "thinking"], {
      env: {
        ...process.env,
        XDG_STATE_HOME: stateHome,
        GHOSTTY_RELOAD_ENABLED: "0",
        HERDR_ENV: "0",
      },
    });

    const runtime = join(stateHome, "ghost-in-the-machine");
    const fragment = readFileSync(join(runtime, "ghostty-state.conf"), "utf8");
    assert.equal(fragment, `custom-shader = ${join(root, "shaders/variants/thinking.glsl")}\n`);
    assert.equal(readFileSync(join(runtime, "active.state"), "utf8"), "thinking\n");
  } finally {
    rmSync(stateHome, { recursive: true, force: true });
  }
});

test("collapsed sidebar gates later lifecycle states to off", () => {
  const stateHome = mkdtempSync(join(tmpdir(), "ghost-sidebar-"));
  const controller = join(root, "scripts/ghost-state.sh");
  const env = {
    ...process.env,
    XDG_STATE_HOME: stateHome,
    GHOSTTY_RELOAD_ENABLED: "0",
    HERDR_ENV: "0",
  };

  try {
    execFileSync("bash", [controller, "apply", "thinking"], { env });
    execFileSync("bash", [controller, "sidebar", "collapsed"], { env });
    execFileSync("bash", [controller, "apply", "working"], { env });

    const runtime = join(stateHome, "ghost-in-the-machine");
    assert.equal(readFileSync(join(runtime, "sidebar.state"), "utf8"), "collapsed\n");
    assert.equal(readFileSync(join(runtime, "active.state"), "utf8"), "off\n");
    assert.equal(readFileSync(join(runtime, "ghostty-state.conf"), "utf8"), "# ghost-in-the-machine: off\n");
  } finally {
    rmSync(stateHome, { recursive: true, force: true });
  }
});

test("expanded sidebar waits for current focus to match its layout", () => {
  const stateHome = mkdtempSync(join(tmpdir(), "ghost-restore-"));
  const controller = join(root, "scripts/ghost-state.sh");
  const fakeHerdr = join(stateHome, "herdr");
  const staleOnce = join(stateHome, "stale-once");
  writeFileSync(fakeHerdr, `#!/usr/bin/env bash
set -euo pipefail
if [[ -e "${staleOnce}" ]]; then
  rm "${staleOnce}"
  printf '%s\\n' '{"result":{"pane":{"pane_id":"pane-2","agent":"pi","focused":true}}}'
  exit
fi
printf '%s\\n' '{"result":{"pane":{"pane_id":"pane-1","agent":"pi","focused":true}}}'
`);
  chmodSync(fakeHerdr, 0o755);
  const env = {
    ...process.env,
    XDG_STATE_HOME: stateHome,
    GHOSTTY_RELOAD_ENABLED: "0",
    HERDR_ENV: "1",
    HERDR_PANE_ID: "pane-1",
    HERDR_SOCKET_PATH: join(stateHome, "herdr.sock"),
    HERDR_BIN_PATH: fakeHerdr,
  };

  try {
    execFileSync("bash", [controller, "set", "working"], { env });
    execFileSync("bash", [controller, "sidebar", "collapsed"], { env });
    writeFileSync(staleOnce, "");
    execFileSync("bash", [controller, "sidebar", "expanded", "pane-1"], { env });

    const runtime = join(stateHome, "ghost-in-the-machine");
    assert.equal(readFileSync(join(runtime, "sidebar.state"), "utf8"), "expanded\n");
    assert.equal(readFileSync(join(runtime, "active.state"), "utf8"), "working\n");
    assert.equal(
      readFileSync(join(runtime, "ghostty-state.conf"), "utf8"),
      `custom-shader = ${join(root, "shaders/variants/working.glsl")}\n`,
    );
  } finally {
    rmSync(stateHome, { recursive: true, force: true });
  }
});
