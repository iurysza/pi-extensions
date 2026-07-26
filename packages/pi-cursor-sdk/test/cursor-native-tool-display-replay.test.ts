import { describe, expect, it } from "vitest";
import { visibleWidth, Text } from "@earendil-works/pi-tui";
import { CURSOR_REPLAY_ACTIVITY_TOOL_NAME } from "../src/cursor-tool-presentation-registry.js";
import {
  CURSOR_REPLAY_COLLAPSED_PREVIEW_LINES,
  CURSOR_REPLAY_PREVIEW_MAX_LINE_CHARS,
  formatCursorReplayDiff,
  formatCursorReplayFilePreview,
  renderCursorReplayCall,
  renderCursorReplayResult,
  renderNativeLookingCursorReadReplayResult,
} from "../src/cursor-native-tool-display-replay.js";
import { LOCAL_READ_PREVIEW_NOTICE } from "../src/cursor-transcript-utils.js";
import { createRenderContext, createRenderTheme } from "./helpers/render-fixtures.js";

const theme = createRenderTheme();

function renderActivity(details: unknown, width = 120, expanded = false): string[] {
  return renderCursorReplayResult(
    { content: [{ type: "text", text: "fallback result\nsecond line" }], details },
    { expanded, isPartial: false },
    theme,
    createRenderContext({ isError: false, showImages: false }),
    false,
  ).render(width);
}

describe("cursor native replay rendering", () => {
  it("bounds huge single-line diffs in standalone native replay cards", () => {
    const hugeLine = "x".repeat(20_000);
    const rendered = formatCursorReplayDiff(
      `--- a/file.txt\n+++ b/file.txt\n@@ -1 +1 @@\n-${hugeLine}\n+${hugeLine}`,
      theme,
      CURSOR_REPLAY_COLLAPSED_PREVIEW_LINES,
    );
    expect(rendered).not.toContain(hugeLine);
    expect(rendered.length).toBeLessThan(CURSOR_REPLAY_PREVIEW_MAX_LINE_CHARS * 4);
    expect(rendered).toContain("…");
  });

  it("bounds huge write previews before rendering", () => {
    const hugeLine = "y".repeat(20_000);
    const rendered = formatCursorReplayFilePreview(hugeLine, "generated.txt", theme);
    expect(rendered).toBeDefined();
    expect(rendered).not.toContain(hugeLine);
    expect(rendered!.length).toBeLessThan(CURSOR_REPLAY_PREVIEW_MAX_LINE_CHARS * 2);
    expect(rendered).toContain("more chars");
  });

  it("uses honest truncation copy for oversized standalone diffs", () => {
    const diff = [
      "--- a/file.txt",
      "+++ b/file.txt",
      "@@ -1,60 +1,60 @@",
      ...Array.from({ length: 60 }, (_, index) => `+line ${index}`),
    ].join("\n");
    const rendered = formatCursorReplayDiff(diff, theme, 40);
    expect(rendered).toContain("more diff lines hidden");
    expect(rendered).not.toContain("full diff");
  });

  it("keeps Cursor-only activity to one bounded neutral line even when expanded", () => {
    const details = {
      variant: "activity",
      sourceToolName: "task",
      title: "Cursor subagent",
      summary: "Inspect package.json · Explore · composer-2.5-fast · ID: agent-1",
      expandedText: "subagent Inspect package.json\n\n1. Package name\n2. Risk",
    };
    for (const expanded of [false, true]) {
      for (const width of [12, 32, 80]) {
        const lines = renderActivity(details, width, expanded);
        expect(lines).toHaveLength(1);
        expect(visibleWidth(lines[0]!)).toBeLessThanOrEqual(width);
        expect(lines[0]).not.toContain("Package name");
      }
    }
  });

  it.each([
    ["mcp", "Cursor MCP", "git · status"],
    ["createPlan", "Cursor plan", "Ship footer integration"],
    ["task", "Cursor subagent", "Inspect package"],
    ["webSearch", "Cursor web search", "Pi extension API"],
    ["generateImage", "Cursor image generation", "saved image.png"],
    ["futureTool", "Cursor futureTool", "future completed"],
  ])("renders %s as a neutral one-line result", (sourceToolName, title, summary) => {
    const details = sourceToolName === "generateImage"
      ? { variant: "generateImage", summary, expandedText: "hidden image details" }
      : sourceToolName === "futureTool"
        ? { variant: "genericFallback", sourceToolName, summary, expandedText: "hidden future details" }
        : { variant: "activity", sourceToolName, title, summary, expandedText: "hidden activity details" };
    const lines = renderActivity(details, 120);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(title);
    expect(lines[0]).toContain(summary);
    expect(lines[0]).not.toContain("hidden");
  });

  it("bounds partial activity calls and sanitizes multiline metadata", () => {
    const component = renderCursorReplayCall(
      CURSOR_REPLAY_ACTIVITY_TOOL_NAME,
      {
        activityTitle: "Cursor MCP\nignored",
        activitySummary: "git status\n" + "x".repeat(500),
      },
      theme,
      true,
    );
    for (const width of [8, 24, 72]) {
      const lines = component.render(width);
      expect(lines).toHaveLength(1);
      expect(visibleWidth(lines[0]!)).toBeLessThanOrEqual(width);
      expect(lines[0]).not.toContain("\n");
    }
  });

  it("shows local read preview disclaimer in collapsed standalone read replay", () => {
    const result = {
      content: [{ type: "text" as const, text: `${LOCAL_READ_PREVIEW_NOTICE}\n# Local preview\n` }],
      details: { localReadPreview: true },
    };
    const rendered = renderNativeLookingCursorReadReplayResult(
      result,
      { expanded: false, isPartial: false },
      theme,
      createRenderContext({ isError: false, args: { path: "README.md", localReadPreview: true } }),
      () => new Text("", 0, 0),
    ).render(120).join("\n");
    expect(rendered).toContain(LOCAL_READ_PREVIEW_NOTICE);
    expect(rendered).not.toContain("# Local preview");
  });
});
