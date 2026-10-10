import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import compactionModel from "../../extensions/compaction-model/index.js";
import { ENTRY_TYPE, reportRows, runningParts, type CompactionReport } from "../../extensions/compaction-model/report.js";

const plain = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

test("a used report renders as a two-line tidy card", () => {
  const report: CompactionReport = { kind: "used", model: "claude-code/claude-haiku-5-5", name: "haiku-5.5", reason: "threshold", sessionModel: "opus-5.5", tokensBefore: 182_000, summaryTokens: 4100, inputTokens: 150_000, keepRecentTokens: 20_000, elapsedMs: 9800 };
  assert.deepEqual(reportRows(report).map(plain), ["󰘕 compact compacted with haiku-5.5 · threshold", "182k → 4.1k tokens → kept 20k recent · 9s"]);
  const expanded = reportRows(report, { expanded: true }).map(plain);
  assert.match(expanded[2], /model\s+claude-code\/claude-haiku-5-5/);
  assert.match(expanded[3], /150,000 tokens/);
  assert.match(expanded.at(-1)!, /opus-5.5 \(not used\)/);
  assert.equal(reportRows(report, { mode: "result" }).length, 1);
});

test("fallback and failure cards say why", () => {
  const fallback = reportRows({ kind: "fallback", model: "a/b", reason: "manual", sessionModel: "opus-5.5", why: "model not found: a/b" }).map(plain);
  assert.deepEqual(fallback, ["󰘕 compact fell back to opus-5.5 · manual", "a/b → model not found: a/b"]);
  assert.match(plain(reportRows({ kind: "failed", model: "a/b", reason: "manual", why: "boom" })[1]), /a\/b → boom/);
});

test("a running card is pending with elapsed time", () => {
  const head = runningParts({ name: "haiku-5.5", reason: "manual", tokensBefore: 182_000, elapsedMs: 3200 }).head.map(plain);
  assert.deepEqual(head, ["· 󰘕 compact compacting with haiku-5.5 · manual", "182k tokens → 3s"]);
});

function fakePi() {
  const handlers = new Map<string, any>();
  const entries: any[] = [];
  const commands = new Map<string, any>();
  const pi = {
    on: (name: string, fn: any) => handlers.set(name, fn),
    registerEntryRenderer: () => {},
    registerCommand: (name: string, options: any) => commands.set(name, options),
    appendEntry: (type: string, data: any) => entries.push({ type, data }),
  };
  compactionModel(pi as any);
  return { handlers, entries, commands };
}

function context(settings: Record<string, unknown>, found = false) {
  const notices: string[] = [];
  const statuses: (string | undefined)[] = [];
  return {
    notices, statuses,
    ctx: {
      cwd: "/tmp", hasUI: true, isProjectTrusted: () => false,
      ui: { notify: (m: string) => notices.push(m), setStatus: (_k: string, t?: string) => statuses.push(t), setWidget: () => {} },
      modelRegistry: {
        find: () => (found ? { id: "claude-haiku-5-5", name: "haiku-5.5" } : undefined),
        getApiKeyAndHeaders: async () => ({ ok: false, error: "no login" }),
      },
      settings,
    },
  };
}

function withSettings(settings: unknown, run: () => Promise<void>) {
  return async () => {
    const dir = mkdtempSync(join(tmpdir(), "compaction-model-"));
    const previous = process.env.PI_CODING_AGENT_DIR;
    writeFileSync(join(dir, "settings.json"), JSON.stringify(settings));
    process.env.PI_CODING_AGENT_DIR = dir;
    try { await run(); } finally {
      if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous;
      rmSync(dir, { recursive: true, force: true });
    }
  };
}
const before = { reason: "threshold", preparation: {}, branchEntries: [], signal: new AbortController().signal };
const haiku = { compactionModel: { model: "claude-code/claude-haiku-5-5" } };

test("no setting means no line and no status", withSettings({}, async () => {
  const { handlers, entries } = fakePi();
  const { ctx, statuses } = context({});
  assert.equal(await handlers.get("session_before_compact")(before, ctx), undefined);
  await handlers.get("session_compact")({ fromExtension: false, reason: "threshold" }, ctx);
  assert.deepEqual(entries, []);
  assert.deepEqual(statuses, []);
}));

test("a missing model records a fallback line and warns", withSettings(haiku, async () => {
  const { handlers, entries } = fakePi();
  const { ctx, notices } = context({}, false);
  assert.equal(await handlers.get("session_before_compact")(before, ctx), undefined);
  await handlers.get("session_compact")({ fromExtension: false, reason: "threshold" }, ctx);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].type, ENTRY_TYPE);
  assert.equal(entries[0].data.kind, "fallback");
  assert.match(entries[0].data.why, /model not found/);
  assert.match(notices[0], /fell back/);
}));

test("auth failure shows a status while trying, then a fallback", withSettings(haiku, async () => {
  const { handlers, entries } = fakePi();
  const { ctx, statuses } = context({}, true);
  assert.equal(await handlers.get("session_before_compact")(before, ctx), undefined);
  assert.deepEqual(statuses, ["compacting with haiku-5.5…", undefined]);
  await handlers.get("session_compact")({ fromExtension: false, reason: "threshold" }, ctx);
  assert.match(entries[0].data.why, /auth failed .*no login/);
}));

test("a failed compaction after a fallback is recorded as failed", withSettings(haiku, async () => {
  const { handlers, entries } = fakePi();
  const { ctx } = context({}, false);
  await handlers.get("session_before_compact")(before, ctx);
  await handlers.get("session_compact_failed")({ aborted: false, errorMessage: "provider down", reason: "threshold" }, ctx);
  assert.deepEqual(entries.map((e) => [e.data.kind, e.data.why]), [["failed", "provider down"]]);
}));

test("/compact-model reports readiness", withSettings(haiku, async () => {
  const { commands } = fakePi();
  const { ctx, notices } = context({}, true);
  await commands.get("compact-model").handler("", ctx);
  assert.match(notices[0], /claude-code\/claude-haiku-5-5 \(haiku-5.5\) · auth failed: no login/);
}));
