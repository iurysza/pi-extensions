import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { renderRichDiff } from "../../../extensions/tool-presentation/rich-diff.js";

const plain = (value: string) => value.replace(/\x1b\[[0-9;]*m/g, "");
const theme = {
  getFgAnsi(role: string) {
    if (role === "toolDiffAdded") return "\x1b[38;2;80;180;100m";
    if (role === "toolDiffRemoved") return "\x1b[38;2;210;90;90m";
    return "\x1b[38;2;130;130;130m";
  },
  getBgAnsi() {
    return "\x1b[48;2;20;20;20m";
  },
};

test("recorded edit diffs render within live terminal widths", async () => {
  for (const width of [40, 80, 120]) {
    const lines = await renderRichDiff({
      toolName: "edit",
      args: { path: "src/value.ts" },
      result: { details: { diff: "-1 const value = 'old'\n+1 const value = 'new'\n 2 export { value }" } },
      width,
      theme,
    });
    assert.ok(lines?.length);
    assert.match(plain(lines!.join("\n")), /old/);
    assert.match(plain(lines!.join("\n")), /new/);
    assert.ok(lines!.every((line) => visibleWidth(line) <= width));
  }
});

test("write content is a presentation fallback when no diff was recorded", async () => {
  const lines = await renderRichDiff({
    toolName: "write",
    args: { path: "notes.ts", content: "export const note = 'hi';\n" },
    result: { content: [{ type: "text", text: "written" }] },
    width: 80,
    theme,
  });
  assert.ok(lines?.length);
  assert.match(plain(lines!.join("\n")), /export const note/);
});
