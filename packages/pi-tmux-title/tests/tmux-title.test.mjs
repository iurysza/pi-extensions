import assert from "node:assert/strict";
import test from "node:test";

import { renameTmuxWindow, slugify } from "../src/index.ts";

test("creates normalized kebab-case titles", () => {
  assert.equal(slugify("Héllo, Pi World!"), "hello-pi-world");
  assert.equal(
    slugify("/var/folders/xx/pi-clipboard-example.png Explain this diagram"),
    "explain-this-diagram",
  );
});

test("truncates titles cleanly", () => {
  const title = slugify("This title is deliberately far longer than twenty four characters");
  assert.equal(title.length <= 24, true);
  assert.equal(title.endsWith("-"), false);
});

test("tmux rename is a no-op outside tmux", async () => {
  const previousTmux = process.env.TMUX;
  const previousPane = process.env.TMUX_PANE;
  delete process.env.TMUX;
  delete process.env.TMUX_PANE;

  try {
    await renameTmuxWindow("safe-title");
  } finally {
    if (previousTmux === undefined) delete process.env.TMUX;
    else process.env.TMUX = previousTmux;
    if (previousPane === undefined) delete process.env.TMUX_PANE;
    else process.env.TMUX_PANE = previousPane;
  }
});
