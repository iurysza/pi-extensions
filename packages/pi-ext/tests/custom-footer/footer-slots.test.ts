import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { stripVTControlCharacters } from "node:util";
import { visibleWidth } from "@earendil-works/pi-tui";
import { SettingsManager, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import customFooter, { formatResponseTime } from "../../extensions/custom-footer/custom-footer.js";
import { agentsFolderFromPrompt, nearestAgentsFolder, renderContextUsage, renderModelInfo, renderPath } from "../../extensions/custom-footer/renderers.js";
import {
  FOOTER_SLOT_HOST_READY,
  FOOTER_SLOT_REGISTER,
  createFooterSlotRegistry,
  packFooterStatuses,
  partitionFooterStatuses,
} from "../../extensions/custom-footer/footer-slots.js";

function fakeEvents() {
  const handlers = new Map<string, Set<(data: unknown) => void>>();
  return {
    emit(channel: string, data: unknown) {
      for (const handler of handlers.get(channel) ?? []) handler(data);
    },
    on(channel: string, handler: (data: unknown) => void) {
      const channelHandlers = handlers.get(channel) ?? new Set();
      channelHandlers.add(handler);
      handlers.set(channel, channelHandlers);
      return () => channelHandlers.delete(handler);
    },
  } as ExtensionAPI["events"];
}

describe("footer slot registry", () => {
  it("accepts producers loaded before or after the host", () => {
    const events = fakeEvents();
    events.on(FOOTER_SLOT_HOST_READY, () => {
      events.emit(FOOTER_SLOT_REGISTER, {
        protocolVersion: 1,
        id: "early",
        priority: 200,
      });
    });

    const registry = createFooterSlotRegistry(events);
    registry.announceHost();
    assert.equal(registry.priorities.get("early"), 200);

    events.emit(FOOTER_SLOT_REGISTER, {
      protocolVersion: 1,
      id: "late",
      priority: 100,
    });
    assert.equal(registry.priorities.get("late"), 100);
    assert.equal(registry.placements.get("late"), "aux");
    events.emit(FOOTER_SLOT_REGISTER, {
      protocolVersion: 1,
      id: "voice",
      priority: 100,
      placement: "core",
    });
    assert.equal(registry.placements.get("voice"), "core");
    events.emit(FOOTER_SLOT_REGISTER, {
      protocolVersion: 1, id: "cache", priority: 200, placement: "context",
    });
    assert.equal(registry.placements.get("cache"), "context");
  });

  it("ignores malformed registrations and clears session metadata", () => {
    const events = fakeEvents();
    const registry = createFooterSlotRegistry(events);
    events.emit(FOOTER_SLOT_REGISTER, { protocolVersion: 2, id: "wrong", priority: 999 });
    events.emit(FOOTER_SLOT_REGISTER, { protocolVersion: 1, id: "", priority: 999 });
    events.emit(FOOTER_SLOT_REGISTER, { protocolVersion: 1, id: "nan", priority: Number.NaN });
    events.emit(FOOTER_SLOT_REGISTER, { protocolVersion: 1, id: "bad-placement", priority: 1, placement: "elsewhere" });
    assert.equal(registry.priorities.size, 0);
    registry.priorities.set("temporary", 1);
    registry.placements.set("temporary", "core");
    registry.clear();
    assert.equal(registry.priorities.size, 0);
    assert.equal(registry.placements.size, 0);
  });
});

describe("custom footer", () => {
  it("shows response age using one compact unit", () => {
    for (const [seconds, expected] of [
      [-1, "0s"], [0, "0s"], [59, "59s"], [60, "1m"],
      [443, "7m"], [3599, "59m"], [3600, "1h"],
      [86399, "23h"], [86400, "1d"], [172800, "2d"],
    ] as const) {
      assert.equal(formatResponseTime(0, seconds * 1000), `◷ ${expected} ago`);
    }
  });

  it("restores instructions and response age across reload and session navigation", async (t) => {
    const now = Date.parse("2026-01-01T12:00:00Z");
    t.mock.method(Date, "now", () => now);
    const completed = {
      type: "message", timestamp: new Date(now - 443_000).toISOString(),
      message: { role: "assistant", stopReason: "stop" },
    };
    let history = [
      completed,
      { ...completed, timestamp: new Date(now).toISOString(), message: { role: "assistant", stopReason: "toolUse" } },
      { ...completed, timestamp: "invalid", message: { role: "assistant", stopReason: "stop" } },
      { ...completed, timestamp: new Date(now).toISOString(), message: { role: "user", stopReason: "" } },
    ];
    const events = fakeEvents();
    const handlers = new Map<string, (event: unknown, ctx: any) => Promise<void>>();
    let footerFactory: ((tui: unknown, theme: unknown, data: unknown) => unknown) | undefined;
    let widgetFactory: ((tui: unknown, theme: unknown) => { render(width: number): string[] }) | undefined;
    const pi = {
      events,
      on(name: string, handler: (event: unknown, ctx: any) => Promise<void>) {
        handlers.set(name, handler);
      },
      getThinkingLevel: () => "off",
    } as unknown as ExtensionAPI;
    const theme = {
      fg(_role: string, text: string) { return text; },
    };
    let usedTokens = 25_600;
    const ctx = {
      cwd: "/repo",
      sessionManager: { getBranch: () => history },
      isProjectTrusted: () => true,
      getSystemPrompt: () => '<project_instructions path="/repo/AGENTS.md">\nfixture\n</project_instructions>',
      model: { id: "test-model", provider: "test", contextWindow: 128_000 },
      getContextUsage: () => ({ percent: usedTokens / 128_000 * 100, tokens: usedTokens, contextWindow: 128_000 }),
      ui: {
        setFooter(factory: unknown) {
          footerFactory = factory as (tui: unknown, theme: unknown, data: unknown) => unknown;
        },
        setWidget(_name: string, factory: unknown) {
          widgetFactory = factory as (tui: unknown, theme: unknown) => { render(width: number): string[] };
        },
      },
    };

    const settings = SettingsManager.inMemory({ compaction: { reserveTokens: 20_000 } });
    customFooter(pi, (cwd, trusted) => {
      assert.equal(cwd, ctx.cwd);
      assert.equal(trusted, true);
      return {
        reload: () => settings.reload(),
        getCompactionSettings(model) {
          assert.deepEqual(model, { provider: "test", id: ctx.model.id });
          const compaction = settings.getCompactionSettings();
          return { ...compaction, reserveTokens: model?.id === "other-model" ? 25_000 : compaction.reserveTokens };
        },
      };
    });
    await handlers.get("session_start")?.({}, ctx);
    let branch: string | undefined = "main";
    footerFactory?.({}, theme, {
      getExtensionStatuses: () => new Map(),
      getGitBranch: () => branch,
      onBranchChange: () => () => {},
    });
    events.emit("mode:change", "yolo");

    const widget = widgetFactory?.({ requestRender() {} }, theme);
    const footer = widget?.render(200).join("\n") ?? "";
    assert.match(footer, /󱂵 \/repo 󰘬 │/);
    assert.doesNotMatch(footer, /YOLO|SAFE|READ-ONLY|\(main\)/);
    assert.match(widget?.render(200)[1] ?? "", /◷ 7m ago/);
    await handlers.get("agent_start")?.({}, ctx);
    assert.match(widget?.render(200)[1] ?? "", /◷ 7m ago/);

    branch = "feature/very-long-branch";
    const feature = widget?.render(200)[0] ?? "";
    assert.match(feature, /󰘬 feature\/very-long-branch │/);
    assert.doesNotMatch(feature, /󱂵|\/repo/);
    const narrow = widget?.render(45)[0] ?? "";
    assert.match(stripVTControlCharacters(narrow), /󰘬 feature\/.*… │ 󱜙/);
    assert.ok(visibleWidth(narrow) <= 45);
    usedTokens = 100_000;
    const countdown = widget?.render(60)[0] ?? "";
    assert.match(countdown, /8\.0k left/);
    assert.ok(visibleWidth(countdown) <= 60);
    ctx.model.id = "other-model";
    assert.match(widget?.render(200).join("\n") ?? "", /3\.0k left/);
    settings.setCompactionEnabled(false);
    assert.doesNotMatch(widget?.render(200).join("\n") ?? "", /left/);
    branch = undefined;
    const withoutBranch = widget?.render(200)[0] ?? "";
    assert.match(withoutBranch, /󱂵 \/repo │/);
    assert.doesNotMatch(withoutBranch, /󰘬/);
    branch = "main";
    assert.match(widget?.render(200)[0] ?? "", /󱂵 \/repo 󰘬 │/);
    ctx.cwd = "/repo/nested";
    ctx.getSystemPrompt = () => '<project_instructions path="/repo/nested/AGENTS.md">\nfixture\n</project_instructions>';
    await handlers.get("session_start")?.({ reason: "reload" }, ctx);
    assert.match(widgetFactory?.({ requestRender() {} }, theme).render(200).join("\n") ?? "", /\/repo\/nested/);
    ctx.getSystemPrompt = () => "No project instructions";
    await handlers.get("session_start")?.({ reason: "reload" }, ctx);
    assert.match(widgetFactory?.({ requestRender() {} }, theme).render(200).join("\n") ?? "", /no AGENTS\.md/);
    assert.match(widgetFactory?.({ requestRender() {} }, theme).render(200)[1] ?? "", /◷ 7m ago/);
    history = [];
    await handlers.get("session_start")?.({ reason: "new" }, ctx);
    const newWidget = widgetFactory?.({ requestRender() {} }, theme);
    assert.doesNotMatch(newWidget?.render(200).join("\n") ?? "", /◷/);
    history = [completed];
    await handlers.get("session_tree")?.({}, ctx);
    assert.match(newWidget?.render(200)[1] ?? "", /◷ 7m ago/);
    await handlers.get("agent_end")?.({}, ctx);
    assert.match(newWidget?.render(200)[1] ?? "", /◷ 0s ago/);
    history = [];
    await handlers.get("session_tree")?.({}, ctx);
    assert.doesNotMatch(newWidget?.render(200).join("\n") ?? "", /◷/);
    await handlers.get("session_shutdown")?.({}, ctx);
  });

  it("places core slots after the token budget and keeps aux slots on line two", async () => {
    const events = fakeEvents();
    const handlers = new Map<string, (event: unknown, ctx: any) => Promise<void>>();
    let footerFactory: ((tui: unknown, theme: unknown, data: unknown) => unknown) | undefined;
    let widgetFactory: ((tui: unknown, theme: unknown) => { render(width: number): string[] }) | undefined;
    const pi = {
      events,
      on(name: string, handler: (event: unknown, ctx: any) => Promise<void>) {
        handlers.set(name, handler);
      },
      getThinkingLevel: () => "off",
    } as unknown as ExtensionAPI;
    const theme = {
      fg(_role: string, text: string) { return text; },
    };
    const ctx = {
      cwd: "/repo",
      sessionManager: { getBranch: () => [] },
      isProjectTrusted: () => true,
      getSystemPrompt: () => '<project_instructions path="/repo/AGENTS.md">\nfixture\n</project_instructions>',
      model: { id: "test-model", provider: "test", contextWindow: 128_000 },
      getContextUsage: () => ({ percent: 20, contextWindow: 128_000 }),
      ui: {
        setFooter(factory: unknown) {
          footerFactory = factory as (tui: unknown, theme: unknown, data: unknown) => unknown;
        },
        setWidget(_name: string, factory: unknown) {
          widgetFactory = factory as (tui: unknown, theme: unknown) => { render(width: number): string[] };
        },
      },
    };

    customFooter(pi, () => SettingsManager.inMemory({ compaction: { reserveTokens: 20_000 } }));
    await handlers.get("session_start")?.({}, ctx);
    await handlers.get("before_agent_start")?.({ systemPromptOptions: {
      cwd: "/repo",
      contextFiles: [{ path: "/repo/AGENTS.md" }],
    } }, ctx);
    events.emit(FOOTER_SLOT_REGISTER, {
      protocolVersion: 1,
      id: "pi-voice",
      priority: 100,
      placement: "core",
    });
    events.emit(FOOTER_SLOT_REGISTER, {
      protocolVersion: 1,
      id: "pi-token-tank",
      priority: 100,
    });
    events.emit(FOOTER_SLOT_REGISTER, {
      protocolVersion: 1,
      id: "pi-cache-hit-predictor",
      priority: 200,
      placement: "context",
    });
    footerFactory?.({}, theme, {
      getExtensionStatuses: () => new Map([
        ["snap", "archived"],
        ["mcp", "MCP connected"],
        ["pi-voice", "🎙"],
        ["pi-token-tank", "tokens"],
        ["pi-cache-hit-predictor", "󱘿"],
      ]),
      getGitBranch: () => "main",
      onBranchChange: () => () => {},
    });
    handlers.get("agent_end")?.({}, ctx);

    const lines = widgetFactory?.({ requestRender() {} }, theme).render(200) ?? [];
    assert.match(lines[0] ?? "", /^ 󱂵 \/repo 󰘬 │ 󱜙 test-model │ ▰▱▱▱▱ 128k  󱘿 │ 🎙/);
    assert.doesNotMatch(lines[0] ?? "", /tokens|MCP|◷/);
    assert.match(lines[1] ?? "", /^ tokens.*MCP connected.*archived.*◷ \d+s ago/);
    assert.doesNotMatch(lines[1] ?? "", /🎙|󱘿/);
    const compact = widgetFactory?.({ requestRender() {} }, theme).render(60)[0] ?? "";
    assert.match(compact, /128k  󱘿/);
    assert.ok(visibleWidth(compact) <= 60);
    ctx.getContextUsage = () => ({ percent: 80, tokens: 100_000, contextWindow: 128_000 });
    const countdown = widgetFactory?.({ requestRender() {} }, theme).render(200)[0] ?? "";
    assert.match(countdown, /[\d.]+k left  󱘿/);

    events.emit(FOOTER_SLOT_REGISTER, {
      protocolVersion: 1,
      id: "pi-voice",
      priority: 90,
      placement: "aux",
    });
    const tiered = widgetFactory?.({ requestRender() {} }, theme).render(200) ?? [];
    assert.doesNotMatch(tiered[0] ?? "", /🎙/);
    assert.match(tiered[1] ?? "", /tokens.*🎙.*MCP connected.*archived.*◷ \d+s ago/);
  });
});

describe("instruction scope and context bar", () => {
  it("reads only loaded instruction tags without guessing from the filesystem", () => {
    const prompt = [
      '<project_instructions path="/home/me/AGENTS.md">',
      '</project_instructions>',
      '<project_instructions path="/home/me/project/AGENTS.md">',
      '</project_instructions>',
      '<project_instructions path="/elsewhere/AGENTS.md">',
      '</project_instructions>',
    ].join("\n");
    assert.equal(agentsFolderFromPrompt(prompt, "/home/me/project/src"), "/home/me/project");
    assert.equal(agentsFolderFromPrompt("", "/home/me/project"), undefined);
  });

  it("selects the nearest loaded instruction folder, not the working folder", () => {
    assert.equal(nearestAgentsFolder([
      { path: "/home/me/.pi/agent/AGENTS.md" },
      { path: "/home/me/AGENTS.md" },
      { path: "/home/me/project/AGENTS.override.md" },
    ], "/home/me/project/src"), "/home/me/project");
    assert.equal(nearestAgentsFolder([{ path: "/home/me/.pi/agent/AGENTS.md" }], "/work"), undefined);
  });

  it("uses normal text for both complete and shortened instruction paths", () => {
    const theme = { fg(role: string, text: string) { return `[${role}:${text}]`; } };
    assert.equal(renderPath("/repo", 30, theme), "[text:/repo]");
    assert.equal(renderPath("/long/project/path", 10, theme), "[text:…/path]");
  });

  it("never leaves partial folder names in the compact path", () => {
    const theme = { fg(_role: string, text: string) { return text; } };
    const path = "~/dev/personal/tools/agents";
    assert.equal(renderPath(path, 10, theme), "…/agents");
    assert.equal(renderPath(path, 15, theme), "…/tools/agents");
    assert.equal(renderPath(path, 8, theme), "…/agents");
    assert.equal(renderPath(path, 6, theme), "agents");
    assert.equal(renderPath(path, 5, theme), "");
    assert.equal(renderPath("/work/项目", 10, theme), "/work/项目");
    for (let width = 0; width < 80; width++) {
      const rendered = renderPath(path, width, theme);
      assert.ok(visibleWidth(rendered) <= width);
      if (rendered) assert.ok(rendered.includes("agents"));
    }
  });

  it("switches maximum window to headroom in the final ten percent before compaction", () => {
    const theme = { fg(_role: string, text: string) { return text; } };
    const compaction = { enabled: true, reserveTokens: 16_384 };
    // 272000 - 16384 = 255616; final 10% starts at 230054.4 tokens.
    assert.equal(renderContextUsage(85, 272_000, 230_054, theme, compaction), "▰▰▰▰▰ 272k");
    assert.equal(renderContextUsage(85, 272_000, 230_055, theme, compaction), "▰▰▰▰▰ 26k left");
    assert.equal(renderContextUsage(89, 272_000, 240_000, theme, compaction), "▰▰▰▰▰ 16k left");
    assert.equal(renderContextUsage(92, 272_000, 255_000, theme, compaction), "▰▰▰▰▰ 616 left");
    assert.equal(renderContextUsage(95, 272_000, 260_000, theme, compaction), "▰▰▰▰▰ 0 left");
    assert.equal(renderContextUsage(0, 272_000, null, theme, compaction), "▱▱▱▱▱ 272k");
    assert.equal(renderContextUsage(95, 272_000, 260_000, theme, { ...compaction, enabled: false }), "▰▰▰▰▰ 272k");
    assert.equal(renderContextUsage(58, 1_000_000, 580_000, theme, { enabled: true, reserveTokens: 400_000 }), "▰▰▰▱▱ 20k left");
  });

  it("warns at 200k estimated context tokens regardless of model window", () => {
    const theme = { fg(role: string, text: string) { return `[${role}:${text}]`; } };
    assert.equal(renderContextUsage(74, 272_000, 199_999, theme), "[success:▰▰▰▰][dim:▱ 272k]");
    assert.equal(renderContextUsage(74, 272_000, 200_000, theme), "[warning:▰▰▰▰][dim:▱ 272k]");
  });
});

describe("renderModelInfo", () => {
  const theme = { fg(role: string, text: string) { return `[${role}:${text}]`; } };

  it("shows a colour-coded speedometer for thinking level and nothing when off", () => {
    assert.equal(renderModelInfo("m", "off", theme).text, "[accent:󱜙 m]");
    assert.equal(renderModelInfo("m", "minimal", theme).text, "[accent:󱜙 m] [dim:󰾆]");
    assert.equal(renderModelInfo("m", "low", theme).text, "[accent:󱜙 m] [success:󰾆]");
    assert.equal(renderModelInfo("m", "medium", theme).text, "[accent:󱜙 m] [warning:󰾅]");
    assert.equal(renderModelInfo("m", "high", theme).text, "[accent:󱜙 m] [bashMode:󰓅]");
    assert.equal(renderModelInfo("m", "xhigh", theme).text, "[accent:󱜙 m] [error:󰓅]");
    assert.equal(renderModelInfo("m", "max", theme).text, "[accent:󱜙 m] [error:󰓅󰓅]");
  });
});

describe("packFooterStatuses", () => {
  it("packs whole slots by descending priority", () => {
    const statuses = new Map([
      ["legacy", "legacy"],
      ["token", "tokens"],
      ["cache", "cache"],
    ]);
    const priorities = new Map([["cache", 200], ["token", 100]]);
    assert.equal(packFooterStatuses(statuses, priorities, 20, " · "), " cache · tokens");
  });

  it("omits all lower priorities once the next slot does not fit", () => {
    const statuses = new Map([
      ["high", "high"],
      ["middle", "middle-is-wide"],
      ["low", "x"],
    ]);
    const priorities = new Map([["high", 200], ["middle", 100], ["low", 0]]);
    assert.equal(packFooterStatuses(statuses, priorities, 12, " · "), " high");
  });

  it("truncates only the highest-priority slot and respects ANSI width", () => {
    const statuses = new Map([
      ["high", "\u001b[31mhighest-priority-value\u001b[39m"],
      ["low", "low"],
    ]);
    const priorities = new Map([["high", 200], ["low", 100]]);
    const packed = packFooterStatuses(statuses, priorities, 9, " · ");
    assert.ok(packed);
    assert.equal(visibleWidth(packed), 9);
    assert.ok(!packed.includes("low"));
  });

  it("sanitizes multiline legacy statuses", () => {
    const packed = packFooterStatuses(new Map([["legacy", "one\ntwo\tthree"]]), new Map(), 40, " · ");
    assert.equal(packed, " one two three");
  });
});

describe("partitionFooterStatuses", () => {
  it("splits inline context, core, and auxiliary slots", () => {
    const { core, aux, context } = partitionFooterStatuses(
      new Map([["pi-voice", "🎙"], ["pi-token-tank", "tokens"], ["legacy", "x"], ["cache", "󱘿"]]),
      new Map([["pi-voice", "core"], ["pi-token-tank", "aux"], ["cache", "context"]]),
    );
    assert.deepEqual([...context.entries()], [["cache", "󱘿"]]);
    assert.deepEqual([...core.entries()], [["pi-voice", "🎙"]]);
    assert.deepEqual([...aux.entries()], [["pi-token-tank", "tokens"], ["legacy", "x"]]);
  });
});
