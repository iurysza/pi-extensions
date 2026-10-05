import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_CONFIG,
  MODE_ENTRY,
  detectSubagent,
  isReadOnlyMemoCommand,
  mentionsMemo,
  guardBash,
  modeFromRules,
  nextActiveTools,
  parseConfig,
  parseWakePart,
  persistedMode,
  resolveMode,
  resolvePaths,
  rewriteForTools,
  systemSection,
  toolsForMode,
  wakeAll,
  wakeMessage,
} from "../src/core.js";

const HOME = "/home/u";
const config = (overrides = {}) => ({ ...DEFAULT_CONFIG, ...overrides });
const vaultRule = { cwd: "~/vault", mode: "on" };

test("mode resolution: flag > session entry > cwd rule > default", () => {
  const base = { config: config({ defaultMode: "read", rules: [vaultRule] }), cwd: "/home/u/vault/notes", isSubagent: false, home: HOME };
  assert.deepEqual(resolveMode({ ...base, flags: { noMemory: true }, persisted: "on" }), { mode: "off", source: "flag", capped: false });
  assert.deepEqual(resolveMode({ ...base, flags: {}, persisted: "off" }), { mode: "off", source: "session", capped: false });
  assert.deepEqual(resolveMode({ ...base, flags: {}, persisted: undefined }), { mode: "on", source: "rule", capped: false });
  assert.deepEqual(resolveMode({ ...base, cwd: "/tmp", flags: {}, persisted: undefined }), { mode: "read", source: "default", capped: false });
});

test("shipped default is off", () => {
  const result = resolveMode({ flags: {}, persisted: undefined, config: DEFAULT_CONFIG, cwd: "/tmp", isSubagent: false });
  assert.equal(result.mode, "off");
});

test("the most restrictive flag wins", () => {
  const base = { persisted: undefined, config: DEFAULT_CONFIG, cwd: "/tmp", isSubagent: false };
  assert.equal(resolveMode({ ...base, flags: { memory: true, memoryRead: true } }).mode, "read");
  assert.equal(resolveMode({ ...base, flags: { memory: true, noMemory: true } }).mode, "off");
  assert.equal(resolveMode({ ...base, flags: { memory: true } }).mode, "on");
});

test("cwd rules match by longest prefix and not by sibling names", () => {
  const rules = [vaultRule, { cwd: "~/vault/private", mode: "off" }];
  assert.equal(modeFromRules(rules, "/home/u/vault/private/x", HOME), "off");
  assert.equal(modeFromRules(rules, "/home/u/vault", HOME), "on");
  assert.equal(modeFromRules(rules, "/home/u/vault-old", HOME), undefined);
});

test("subagents are capped at subagentMode, even with --memory", () => {
  const base = { persisted: undefined, cwd: "/tmp", isSubagent: true };
  assert.deepEqual(resolveMode({ ...base, flags: { memory: true }, config: DEFAULT_CONFIG }), { mode: "off", source: "flag", capped: true });
  assert.deepEqual(resolveMode({ ...base, flags: { memory: true }, config: config({ subagentMode: "read" }) }), { mode: "read", source: "flag", capped: true });
  assert.deepEqual(resolveMode({ ...base, flags: {}, config: config({ subagentMode: "read" }) }), { mode: "off", source: "default", capped: false });
});

test("subagent detection: print and json modes, or explicit env", () => {
  assert.equal(detectSubagent("print", {}), true);
  assert.equal(detectSubagent("json", {}), true);
  assert.equal(detectSubagent("tui", {}), false);
  assert.equal(detectSubagent("rpc", {}), false);
  assert.equal(detectSubagent("tui", { PI_OPTMEM_SUBAGENT: "1" }), true);
});

test("persisted mode reads the latest entry on the branch", () => {
  const branch = [
    { type: "custom", customType: MODE_ENTRY, data: { mode: "on" } },
    { type: "message", message: {} },
    { type: "custom", customType: "other", data: { mode: "off" } },
    { type: "custom", customType: MODE_ENTRY, data: { mode: "read" } },
    { type: "custom", customType: MODE_ENTRY, data: { mode: "bogus" } },
  ];
  assert.equal(persistedMode(branch), "read");
  assert.equal(persistedMode([]), undefined);
});

test("config parsing validates fields and rejects unknown keys", () => {
  assert.deepEqual(parseConfig({}), { ok: true, config: DEFAULT_CONFIG });
  assert.equal(parseConfig({ defaultMode: "on", rules: [vaultRule] }).ok, true);
  assert.equal(parseConfig({ defaultMode: "maybe" }).ok, false);
  assert.equal(parseConfig({ subagentMode: "on" }).ok, false);
  assert.equal(parseConfig({ rules: [{ cwd: "/x", mode: "loud" }] }).ok, false);
  assert.equal(parseConfig({ extra: 1 }).ok, false);
  assert.equal(parseConfig([]).ok, false);
});

test("MEMORY_DIR in the environment wins over config", () => {
  assert.deepEqual(resolvePaths(DEFAULT_CONFIG, {}, HOME), {
    memoPath: "/home/u/.local/share/optmem/memo",
    memoryDir: "/home/u/.local/share/optmem/memory",
  });
  assert.equal(resolvePaths(DEFAULT_CONFIG, { MEMORY_DIR: "/tmp/m" }, HOME).memoryDir, "/tmp/m");
});

test("tool sets per mode", () => {
  assert.deepEqual(toolsForMode("off"), []);
  assert.deepEqual(toolsForMode("read"), ["memo_zoom", "memo_recall"]);
  assert.deepEqual(toolsForMode("on"), ["memo_note", "memo_zoom", "memo_recall", "memo_nap"]);
  assert.deepEqual(nextActiveTools(["read", "memo_note", "bash"], "read"), ["read", "bash", "memo_zoom", "memo_recall"]);
  assert.deepEqual(nextActiveTools(["read", "memo_zoom"], "off"), ["read"]);
});

test("prompt sections per mode", () => {
  assert.equal(systemSection("off", "/m"), undefined);
  const read = systemSection("read", "/m");
  assert.match(read, /read-only/);
  assert.doesNotMatch(read, /memo_note/);
  assert.doesNotMatch(read, /memo_nap/);
  const on = systemSection("on", "/m");
  assert.match(on, /memo_note/);
  assert.match(on, /memo_nap/);
  assert.match(on, /Never store IDs/);
  assert.match(on, /You are a subagent\. Don't run memo\./);
});

test("bash guard: off blocks every mention of memo", () => {
  for (const command of ["memo wake", "~/.local/share/optmem/memo recall x", "python3 /x/memo note hi", "cd /x && memo zoom 0-1", "grep memo notes.md", "cat /x/memo.py"]) {
    assert.equal(guardBash(command, "off").allow, false, command);
  }
  assert.equal(guardBash("ls -la", "off").allow, true);
  assert.equal(guardBash("cat memo.txt", "off").allow, true);
  assert.equal(guardBash("echo memorandum", "off").allow, true);
});

test("bash guard: read allows simple wake, zoom and recall only", () => {
  for (const command of ["memo wake", "memo wake 2 300", "memo zoom 0-1", "MEMORY_DIR=/x memo recall foo", "python3 /tmp/memo.py recall 'tea|coffee'", "~/.local/share/optmem/memo wake"]) {
    assert.equal(guardBash(command, "read").allow, true, command);
  }
  for (const command of ["memo", "memo note hi", "memo nap 0-1 x", "memo forget 0-1", "memo init", "memo config WAKE_LINES=3", "memo import f", "memo wake; memo note x", "env memo note x", "memo wake && memo note x", "memo recall x | tee y", "memo wake > /tmp/out", "echo $(memo note x)"]) {
    assert.equal(guardBash(command, "read").allow, false, command);
  }
});

// Finding 1: conditionals and loops hid the memo call from the old parser.
test("bash guard fails closed on conditionals, loops and other shell forms", () => {
  const sneaky = [
    'if true; then python3 /tmp/memo.py note "example"; fi',
    'while false; do memo note x; done',
    'for i in 1; do memo nap 0-1 x; done',
    '{ memo note x; }',
    'bash -c "memo note x"',
    'sh -c \'memo note x\'',
    'eval "memo note x"',
    'xargs memo note < f',
    'M=memo; $M note x',
    'case a in a) memo note x;; esac',
    '"/opt/Opt Mem/memo" note x',
  ];
  for (const command of sneaky) {
    assert.equal(guardBash(command, "read").allow, false, `read: ${command}`);
    assert.equal(guardBash(command, "off").allow, false, `off: ${command}`);
  }
});

test("bash guard matches the configured memo path and memory dir", () => {
  assert.equal(mentionsMemo("/opt/x/tool note hi", "/opt/x/tool"), true);
  assert.equal(guardBash("/opt/x/tool note hi", "read", "/opt/x/tool").allow, false);
  assert.equal(guardBash("/opt/x/tool wake", "read", "/opt/x/tool").allow, true);
  assert.equal(guardBash("cat /m/LOG.txt", "off", undefined, "/m").allow, false);
  assert.equal(isReadOnlyMemoCommand('"/opt/Opt Mem/memo" wake'), true);
});

test("bash guard: on allows everything", () => {
  assert.equal(guardBash("memo note hi", "on").allow, true);
  assert.equal(guardBash("memo forget 0-1", "on").allow, true);
});

test("nap requests become memo_nap instructions", () => {
  const output = 'Saved as #1.\n\nCompress memories #0-1 into one line.\n\n  #0 a\n  #1 b\n\nRun: /home/u/.local/share/optmem/memo nap 0-1 "<your line>"';
  const rewritten = rewriteForTools(output);
  assert.match(rewritten, /Call memo_nap with range "0-1"/);
  assert.doesNotMatch(rewritten, /Run: /);
});

const PART1 = "Your memory, part 1 of 2, oldest first (300 memories).\n#0-127 old stuff\n#128-191 more\nNot awake yet. Run: /x/memo wake 2 300\n";
const PART2 = "Your memory, part 2 of 2, oldest first (300 memories).\n#299 2026-10-05 newest\nYou are awake.\n\nCompress memories #298-299 into one line of at most 280 bytes.\nRun: /x/memo nap 298-299 \"<your line>\"\n";

test("wake part parsing", () => {
  assert.deepEqual(parseWakePart(PART1), { lines: ["#0-127 old stuff", "#128-191 more"], next: ["2", "300"], awake: false, tail: "" });
  const last = parseWakePart(PART2);
  assert.deepEqual(last.lines, ["#299 2026-10-05 newest"]);
  assert.equal(last.next, undefined);
  assert.match(last.tail, /^Compress memories #298-299/);
});

test("wake fetches every part", async () => {
  const calls = [];
  const result = await wakeAll(async (args) => {
    calls.push(args);
    return { code: 0, stdout: args.length === 1 ? PART1 : PART2, stderr: "" };
  });
  assert.deepEqual(calls, [["wake"], ["wake", "2", "300"]]);
  assert.equal(result.kind, "awake");
  assert.deepEqual(result.lines, ["#0-127 old stuff", "#128-191 more", "#299 2026-10-05 newest"]);
  assert.match(result.nap, /298-299/);
  const message = wakeMessage("on", result);
  assert.match(message, /<optmem-wake mode="on">/);
  assert.match(message, /memo_nap with range "298-299"/);
  assert.doesNotMatch(wakeMessage("read", result), /memo_nap/);
});

test("wake handles empty memory, blocked wakes and errors", async () => {
  const empty = await wakeAll(async () => ({ code: 0, stdout: 'No memories yet. Record the first with: /x/memo note "<one line>"\nYou are awake.\n', stderr: "" }));
  assert.equal(empty.kind, "awake");
  assert.deepEqual(empty.lines, ['No memories yet. Record the first with: /x/memo note "<one line>"']);

  const blocked = await wakeAll(async () => ({ code: 1, stdout: "Cannot wake: the memory context needs #0-127\nRun: /x/memo nap 0-1 \"<your line>\"", stderr: "" }));
  assert.equal(blocked.kind, "blocked");
  assert.match(wakeMessage("on", blocked), /memo_nap/);
  assert.match(wakeMessage("read", blocked), /status="unavailable"/);

  const failed = await wakeAll(async () => ({ code: 1, stdout: "", stderr: "No memory at /x." }));
  assert.deepEqual(failed, { kind: "error", message: "No memory at /x." });
});

// Finding 6: a memo path with spaces hid the continuation footer.
test("wake follows continuations and nap requests under a spaced path", async () => {
  const spaced = PART1.replace("/x/memo", "/Users/me/Opt Mem/memo");
  assert.deepEqual(parseWakePart(spaced).next, ["2", "300"]);
  const result = await wakeAll(async (args) => ({ code: 0, stdout: args.length === 1 ? spaced : PART2.replace("/x/memo", "/a b/memo"), stderr: "" }));
  assert.equal(result.kind, "awake");
  assert.equal(result.lines.length, 3);
  assert.match(rewriteForTools('Run: /a b/memo nap 0-1 "<your line>"'), /Call memo_nap with range "0-1"/);
});

test("wake without an awake marker or a next part is an error", async () => {
  const result = await wakeAll(async () => ({ code: 0, stdout: "#0 x\nNot awake yet. Run: ???\n", stderr: "" }));
  assert.equal(result.kind, "error");
});

test("wake stops after a bounded number of parts", async () => {
  const result = await wakeAll(async () => ({ code: 0, stdout: PART1, stderr: "" }));
  assert.equal(result.kind, "error");
});
