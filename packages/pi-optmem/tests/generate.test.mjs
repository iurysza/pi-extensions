import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { filterLines, parseLine } from "../src/generate/filter.js";
import { genPaths, readJob, readState } from "../src/generate/job.js";
import { DISTIL_RULES, ModelClient, distilLines, distilPrompt, makeBatches, parseNaps } from "../src/generate/model.js";
import { main, sinceDate } from "../src/generate/cli.js";
import { capTranscript, discoverSessions, extractSession } from "../src/generate/sessions.js";
import { selectSessions, spread } from "../src/generate/pipeline.js";
import { logLength, pendingBlocks, readMemories } from "../src/memstore.js";

const here = dirname(fileURLToPath(import.meta.url));
const FAKE = join(here, "fixtures", "fake-model.mjs");
chmodSync(FAKE, 0o755);
const MEMO = process.env.PI_OPTMEM_TEST_MEMO;

function entry(type, extra) {
  return JSON.stringify({ type, ...extra });
}
function msg(role, text, timestamp) {
  return entry("message", { timestamp, message: { role, content: [{ type: "text", text }] } });
}
function sessionFile(dir, slug, name, { id, ts, cwd = "/w", parent, lines }) {
  mkdirSync(join(dir, slug), { recursive: true });
  const path = join(dir, slug, name);
  writeFileSync(path, [entry("session", { id, timestamp: ts, cwd, ...(parent ? { parentSession: parent } : {}) }), ...lines].join("\n") + "\n");
  return path;
}

test("discovery keeps top-level sessions only and skips scratch dirs", () => {
  const dir = mkdtempSync(join(tmpdir(), "optmem-ses-"));
  try {
    sessionFile(dir, "--Users-a--", "1.jsonl", { id: "1", ts: "2025-01-02T10:00:00Z", lines: [] });
    sessionFile(dir, "--Users-a--", "0.jsonl", { id: "0", ts: "2025-01-01T10:00:00Z", lines: [] });
    sessionFile(dir, "--private-tmp-x--", "t.jsonl", { id: "t", ts: "2025-01-01T10:00:00Z", lines: [] });
    sessionFile(dir, "--Users-review-pr-1--", "r.jsonl", { id: "r", ts: "2025-01-01T10:00:00Z", lines: [] });
    sessionFile(join(dir, "--Users-a--"), "sub", "s.jsonl", { id: "s", ts: "2025-01-01T10:00:00Z", lines: [] });
    writeFileSync(join(dir, "--Users-a--", "bad.jsonl"), "not json\n");
    assert.deepEqual(discoverSessions(dir).map((s) => s.id), ["0", "1"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("extraction keeps user text and final assistant text; drops copied parent history and caught-up turns", () => {
  const header = { path: "p", id: "c", timestamp: "2025-02-01T00:00:00Z", cwd: "/w", parentSession: "/x.jsonl" };
  const text = [
    msg("user", "old parent turn", "2025-01-01T00:00:00Z"),
    msg("user", 'hi <skill name="x" location="y">long body</skill> there', "2025-02-01T01:00:00Z"),
    msg("assistant", "thinking aloud", "2025-02-01T01:00:01Z"),
    entry("message", { timestamp: "2025-02-01T01:00:02Z", message: { role: "toolResult", content: [{ type: "text", text: "tool noise" }] } }),
    msg("assistant", "final answer", "2025-02-01T01:00:03Z"),
    msg("user", "second", "2025-02-02T01:00:00Z"),
  ].join("\n");
  const out = extractSession(header, text);
  assert.deepEqual(out.turns, [{ user: "hi [skill x] there", assistant: "final answer" }, { user: "second", assistant: "" }]);
  assert.equal(out.lastTime, "2025-02-02T01:00:00Z");
  assert.deepEqual(extractSession(header, text, "2025-02-01T01:00:03Z").turns, [{ user: "second", assistant: "" }]);
  assert.equal(extractSession(header, text, "2030-01-01T00:00:00Z"), undefined);
});

test("transcript cap keeps every user message", () => {
  const turns = Array.from({ length: 80 }, (_, i) => ({ user: `question ${i} ${"x".repeat(200)}`, assistant: "y".repeat(800) }));
  const text = capTranscript(turns, 12_000);
  assert.ok(text.length <= 12_000);
  for (const i of [0, 1, 40, 78, 79]) assert.match(text, new RegExp(`question ${i} `));
});

test("privacy rules (off by default) drop IDs, emails, IBANs, tokens, money and phones", () => {
  for (const bad of [
    "2025-01-01 Passport X12345678",
    "2025-01-01 Card 4111 1111 1111 1111",
    "2025-01-01 Write to a.b@c.de",
    "2025-01-01 IBAN DE89 3704 0044 0532 0130 00",
    "2025-01-01 key sk-abcdefghijklmnop",
    "2025-01-01 token ab12cd34ef56gh78ij90kl12mn",
    "2025-01-01 Rent is €1,200 a month",
    "2025-01-01 Paid 300 EUR",
    "2025-01-01 Call +49 151 2345 6789",
  ]) {
    assert.ok("drop" in parseLine(bad, true), bad);
    assert.ok(!("drop" in parseLine(bad)), `kept while disabled: ${bad}`);
  }
  assert.deepEqual(parseLine("- 2025-01-01 Prefers Kotlin for Android"), { date: "2025-01-01", text: "Prefers Kotlin for Android" });
  assert.deepEqual(parseLine("2025-02-30 bad date"), { drop: "format" });
  assert.deepEqual(parseLine(`2025-01-01 ${"a".repeat(281)}`), { drop: "too-long" });
  assert.equal(parseLine("NONE"), undefined);
  const result = filterLines(["2025-03-01 B", "2025-01-01 A", "2025-02-01 a!", "2025-01-01 mail x@y.io", "garbage"]);
  assert.deepEqual(result.lines.map((l) => l.text), ["A", "mail x@y.io", "B"]);
  assert.deepEqual(result.dropped, { duplicate: 1, format: 1 });
});

test("batches, distil line dates and nap parsing", () => {
  const item = (date, n) => ({ session: { path: date, cwd: "/w" }, date, turns: [{ user: "x".repeat(n), assistant: "" }] });
  const batches = makeBatches([item("2025-01-01", 900), item("2025-01-02", 900), item("2025-01-03", 900)], 2_000, 8);
  assert.deepEqual(batches.map((b) => b.items.length), [2, 1]);
  assert.deepEqual(distilLines("2025-01-01 ok\n2024-12-31 wrong date\n", batches[0]), ["2025-01-01 ok", "bad-date 2024-12-31 wrong date"]);
  assert.deepEqual([...parseNaps("B1 one\n[B3]: three\nB9 out of range\nB1 dup\n", 3)], [[0, "one"], [2, "three"]]);
  assert.deepEqual(spread([1, 2, 3, 4, 5, 6, 7, 8, 9], 3), [1, 5, 9]);
});

test("distilPrompt uses custom rules when given, the built-in ones otherwise", () => {
  const item = { session: { path: "p", cwd: "/w" }, date: "2025-01-01", turns: [{ user: "hi", assistant: "" }] };
  const [batch] = makeBatches([item], 2_000, 8);
  assert.ok(distilPrompt(batch).startsWith(DISTIL_RULES));
  const custom = distilPrompt(batch, "  MY RULES  ");
  assert.ok(custom.startsWith("MY RULES\n\n=== Session 1 | date 2025-01-01 | cwd /w ==="));
  assert.ok(!custom.includes("You distil past chat sessions"));
});

test("model client retries, then falls back to Pi's default once", async () => {
  const calls = [];
  const client = new ModelClient({
    model: "bad/model",
    backoffMs: 1,
    call: async (_prompt, model) => {
      calls.push(model);
      return model ? { code: 1, stdout: "", stderr: "Error: unknown model bad/model" } : { code: 0, stdout: "ok", stderr: "" };
    },
  });
  assert.deepEqual(await Promise.all([client.complete("a"), client.complete("b")]), ["ok", "ok"]);
  assert.deepEqual(calls, ["bad/model", undefined, undefined], "fan-out waits for the first call's fallback");
  assert.equal(client.modelUsed, "(pi default)");

  let n = 0;
  const flaky = new ModelClient({ model: "m", backoffMs: 1, call: async () => (++n < 3 ? { code: 1, stdout: "", stderr: "rate limit" } : { code: 0, stdout: "ok", stderr: "" }) });
  assert.equal(await flaky.complete("x"), "ok");
  assert.equal(n, 3);
});

test("selectSessions filters by project substring and start date", () => {
  const s = (cwd, timestamp) => ({ path: cwd + timestamp, id: cwd, timestamp, cwd });
  const all = [s("/dev/agents2", "2025-01-01T12:00:00Z"), s("/dev/Thoughtbox", "2025-01-05T12:00:00Z"), s("/dev/agents2", "2025-01-09T12:00:00Z")];
  assert.equal(selectSessions(all).length, 3);
  assert.deepEqual(selectSessions(all, { projects: ["agents2"] }).map((x) => x.timestamp.slice(0, 10)), ["2025-01-01", "2025-01-09"]);
  assert.deepEqual(selectSessions(all, { projects: ["thoughtbox", "nope"] }).map((x) => x.cwd), ["/dev/Thoughtbox"]);
  assert.deepEqual(selectSessions(all, { from: "2025-01-05" }).map((x) => x.cwd), ["/dev/Thoughtbox", "/dev/agents2"]);
  assert.deepEqual(selectSessions(all, { projects: ["agents2"], from: "2025-01-05" }).length, 1);
});

test("sinceDate accepts YYYY-MM-DD and Nd", () => {
  assert.equal(sinceDate("2025-03-04", new Date()), "2025-03-04");
  assert.equal(sinceDate("7d", new Date(2025, 0, 10, 12)), "2025-01-03");
  assert.throws(() => sinceDate("last week", new Date()), /--since needs/);
  assert.throws(() => sinceDate("2025-13-40", new Date()), /--since needs/);
});

test("cli: usage and argument errors", async () => {
  const out = [];
  assert.equal(await main(["--help"], {}, (m) => out.push(m)), 0);
  assert.match(out[0], /Usage: generate\.mjs/);
  assert.equal(await main(["generate", "--limit", "0"], {}, (m) => out.push(m)), 2);
  assert.equal(await main(["generate", "--dry-run", "--yes"], {}, (m) => out.push(m)), 2);
  assert.equal(await main(["generate", "--since", "soon"], {}, (m) => out.push(m)), 2);
  assert.equal(await main(["generate", "--project"], {}, (m) => out.push(m)), 2);
  assert.equal(await main(["bogus"], {}, (m) => out.push(m)), 2);
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "optmem-gen-"));
  const sessions = join(root, "sessions");
  for (let i = 0; i < 12; i++) {
    const day = String(i + 1).padStart(2, "0");
    sessionFile(sessions, `--Users-p${i % 3}--`, `${i}.jsonl`, {
      id: `s${i}`,
      ts: `2025-01-${day}T09:00:00Z`,
      cwd: `/p${i % 3}`,
      lines: [msg("user", `topic ${i}${i === 4 ? " SECRET" : ""}`, `2025-01-${day}T09:01:00Z`), msg("assistant", `done ${i}`, `2025-01-${day}T09:02:00Z`)],
    });
  }
  const env = {
    PATH: process.env.PATH,
    // Real HOME: python3 may be a version-manager shim. Every path below is explicit.
    HOME: process.env.HOME,
    PI_CODING_AGENT_DIR: join(root, "agent"),
    PI_OPTMEM_MODEL_CMD: FAKE,
    FAKE_MODEL_LOG: join(root, "calls.log"),
    MEMORY_DIR: join(root, "mem", "memory"),
  };
  mkdirSync(env.PI_CODING_AGENT_DIR, { recursive: true });
  writeFileSync(join(env.PI_CODING_AGENT_DIR, "pi-optmem.json"), JSON.stringify({ memoPath: MEMO ?? "/nonexistent" }));
  const run = async (...args) => {
    const out = [];
    const code = await main([...args, "--sessions-dir", sessions], env, (m) => out.push(m));
    return { code, out: out.join("\n") };
  };
  return { root, env, run, memoryDir: env.MEMORY_DIR, paths: genPaths(env.MEMORY_DIR) };
}

test("generate --dry-run writes a filtered draft and imports nothing", async () => {
  const f = fixture();
  try {
    const r = await f.run("generate", "--dry-run");
    assert.equal(r.code, 0, r.out);
    const draft = readFileSync(f.paths.draft, "utf8").trim().split("\n");
    assert.equal(draft.length, 14);
    assert.equal(draft.filter((l) => /^2025-01-\d\d Session \d in \/p\d: topic \d+/.test(l)).length, 12);
    assert.equal(readJob(f.paths).phase, "awaiting-confirm");
    assert.equal(readJob(f.paths).dropped, 0, "privacy filter is off");
    assert.equal(existsSync(f.memoryDir), false);
    assert.equal(existsSync(f.paths.lock), false, "lock released");
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("--project and --since narrow the distilled sessions", async () => {
  const f = fixture();
  try {
    const r = await f.run("generate", "--project", "/p1", "--since", "2025-01-05");
    assert.equal(r.code, 0, r.out);
    const sessionLines = readFileSync(f.paths.draft, "utf8").trim().split("\n").filter((l) => / Session \d in /.test(l));
    assert.ok(sessionLines.every((l) => l.includes(" in /p1:")), sessionLines.join("\n"));
    const dates = sessionLines.map((l) => l.slice(0, 10));
    // p1 sessions start on days 2, 5, 8 and 11; the date drops day 2.
    assert.deepEqual(dates, ["2025-01-05", "2025-01-08", "2025-01-11"]);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("--min-turns skips short sessions", async () => {
  const f = fixture();
  try {
    // Give session 3 a second user turn; every other fixture session has one.
    const sessions = join(f.root, "sessions");
    const path = join(sessions, "--Users-p0--", "3.jsonl");
    writeFileSync(path, readFileSync(path, "utf8") + msg("user", "follow up", "2025-01-04T09:03:00Z") + "\n");
    const r = await f.run("generate", "--min-turns", "2");
    assert.equal(r.code, 0, r.out);
    const sessionLines = readFileSync(f.paths.draft, "utf8").trim().split("\n").filter((l) => / Session \d in /.test(l));
    assert.equal(sessionLines.length, 1, sessionLines.join("\n"));
    assert.match(sessionLines[0], /^2025-01-04 .*topic 3/);
    assert.equal(await main(["generate", "--min-turns", "0"], {}, () => {}), 2);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("--limit spreads across history; a stopped distil resumes without redoing sessions", async () => {
  const f = fixture();
  try {
    await f.run("generate", "--limit", "3");
    const dates = readFileSync(f.paths.draft, "utf8").trim().split("\n").map((l) => l.slice(0, 10));
    assert.deepEqual(dates, ["2025-01-01", "2025-01-07", "2025-01-12"]);

    // Simulate a kill mid-distil: phase distil with 2 sessions done.
    const job = readJob(f.paths);
    job.phase = "distil";
    job.processedSessions = job.processedSessions.slice(0, 2);
    writeFileSync(f.paths.job, JSON.stringify(job));
    const lines = readFileSync(f.paths.lines, "utf8").split("\n").filter(Boolean);
    writeFileSync(f.paths.lines, `${lines[0]}\n`);
    rmSync(f.env.FAKE_MODEL_LOG, { force: true });
    await f.run("generate", "--limit", "3");
    assert.equal(readFileSync(f.env.FAKE_MODEL_LOG, "utf8").trim().split("\n").length, 1, "one batch re-run");
    assert.equal(readJob(f.paths).id, job.id, "same job resumed");
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("a live lock blocks a second job", async () => {
  const f = fixture();
  try {
    mkdirSync(f.paths.dir, { recursive: true });
    writeFileSync(f.paths.lock, String(process.pid));
    const r = await f.run("generate");
    assert.equal(r.code, 1);
    assert.match(r.out, /Another generation job is running/);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("bad model id falls back to Pi's default and the job records it", async () => {
  const f = fixture();
  try {
    f.env.FAKE_MODEL_FAIL = "bad/model";
    const r = await f.run("generate", "--model", "bad/model", "--limit", "2");
    assert.equal(r.code, 0, r.out);
    assert.equal(readJob(f.paths).modelUsed, "(pi default)");
    assert.match(readFileSync(f.paths.log, "utf8"), /retrying with Pi's default model/);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("e2e with real memo: import, naps, catchup, rebuild backup", { skip: !MEMO && "set PI_OPTMEM_TEST_MEMO to a memo binary" }, async () => {
  const f = fixture();
  try {
    let r = await f.run("generate", "--yes");
    assert.equal(r.code, 0, r.out);
    assert.equal(logLength(f.memoryDir), 14, "12 sessions plus 2 extra lines from the SECRET session (privacy filter off)");
    assert.deepEqual(pendingBlocks(f.memoryDir), [], "all naps written");
    assert.equal(readJob(f.paths).phase, "done");
    assert.equal(readState(f.paths).lastSessionTime, "2025-01-12T09:02:00Z");

    r = await f.run("generate");
    assert.equal(r.code, 1);
    assert.match(r.out, /not empty/);

    // Catch up: one new session and one new turn in an old session.
    const sessions = join(f.root, "sessions");
    sessionFile(sessions, "--Users-p0--", "new.jsonl", { id: "n", ts: "2025-01-20T09:00:00Z", cwd: "/p0", lines: [msg("user", "fresh topic", "2025-01-20T09:01:00Z")] });
    writeFileSync(join(sessions, "--Users-p0--", "0.jsonl"), `${readFileSync(join(sessions, "--Users-p0--", "0.jsonl"), "utf8")}${msg("user", "late follow up", "2025-01-21T09:00:00Z")}\n`);
    r = await f.run("catchup", "--yes");
    assert.equal(r.code, 0, r.out);
    const texts = readMemories(f.memoryDir, 14, logLength(f.memoryDir)).map((m) => m.text);
    assert.equal(texts.length, 2);
    assert.match(texts.join("|"), /fresh topic/);
    assert.match(texts.join("|"), /late follow up/);
    assert.doesNotMatch(texts.join("|"), /topic 0\b/, "old turns not redone");

    // Rebuild moves the store aside.
    r = await f.run("rebuild", "--yes", "--limit", "2");
    assert.equal(r.code, 0, r.out);
    const job = readJob(f.paths);
    assert.match(job.backup, /memory\.bak-\d{8}-\d{4}$/);
    assert.equal(logLength(job.backup), 16);
    assert.equal(logLength(f.memoryDir), 2);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- menu side

import { GENERATE_HANDLERS, generationFooter, maybeOnboard, reviewText } from "../src/generate/ui.js";
import { writeJob, newJob } from "../src/generate/job.js";

function uiEnv(root, { select, confirm = true } = {}) {
  const notes = [];
  const launches = [];
  const memoryDir = join(root, "mem", "memory");
  return {
    notes,
    launches,
    memoryDir,
    c: {
      ctx: {
        hasUI: true,
        ui: {
          notify: (message) => notes.push(message),
          select: async (title, options) => (notes.push(title), select?.(options)),
          confirm: async () => confirm,
          editor: async (title, text) => notes.push(`${title}\n${text}`),
        },
      },
      config: { model: "m/x" },
      paths: { memoPath: "/bin/sh", memoryDir },
      env: { PI_CODING_AGENT_DIR: join(root, "agent") },
      memoExists: () => true,
      launch: (args, dir) => launches.push({ args, dir }),
    },
  };
}

test("onboarding shows once per machine and only for an empty memory with sessions", () => {
  const root = mkdtempSync(join(tmpdir(), "optmem-onb-"));
  try {
    const u = uiEnv(root);
    const ctx = u.c.ctx;
    assert.equal(maybeOnboard(ctx, u.memoryDir, u.c.env), false, "no sessions, no hint");
    sessionFile(join(root, "agent", "sessions"), "--Users-a--", "1.jsonl", { id: "1", ts: "2025-01-01T00:00:00Z", lines: [] });
    assert.equal(maybeOnboard(ctx, u.memoryDir, u.c.env), true);
    assert.match(u.notes.at(-1), /Memory is empty\. Leader → b → g → g \(Generate\) builds it from 1 past sessions/);
    assert.equal(maybeOnboard(ctx, u.memoryDir, u.c.env), false, "marker stops a second hint");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("generate launches detached work and the review dialog imports only on Import", async () => {
  const root = mkdtempSync(join(tmpdir(), "optmem-ui-"));
  try {
    const u = uiEnv(root);
    await GENERATE_HANDLERS.generate("", u.c);
    assert.deepEqual(u.launches[0].args, ["generate", "--memory-dir", u.memoryDir, "--model", "m/x"]);

    // A draft is waiting: generate shows the review instead of starting again.
    const paths = genPaths(u.memoryDir);
    const job = newJob("generate", "m/x");
    Object.assign(job, { phase: "awaiting-confirm", processed: 3, lines: 2, dropped: 1 });
    writeJob(paths, job);
    writeFileSync(paths.draft, "2025-01-01 one\n2025-02-01 two\n");
    const cancelled = uiEnv(root, { select: () => "Cancel" });
    await GENERATE_HANDLERS.generate("", cancelled.c);
    assert.equal(cancelled.launches.length, 0);
    assert.match(cancelled.notes[0], /2 memory lines from 3 sessions \(2025-01-01 to 2025-02-01\)/);
    assert.match(cancelled.notes[0], /Filter dropped 1 lines/);

    const accepted = uiEnv(root, { select: () => "Import" });
    await GENERATE_HANDLERS.generate("", accepted.c);
    assert.deepEqual(accepted.launches[0].args.slice(0, 1), ["import"]);
    assert.equal(generationFooter(u.memoryDir), "\u{F012C} review");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rebuild needs a confirm; a declined confirm launches nothing", async () => {
  const root = mkdtempSync(join(tmpdir(), "optmem-rb-"));
  try {
    const u = uiEnv(root, { select: (o) => o[1], confirm: false });
    mkdirSync(u.memoryDir, { recursive: true });
    writeFileSync(join(u.memoryDir, "LOG.txt"), `${"#0 2025-01-01 x".padEnd(319)}\n`);
    await GENERATE_HANDLERS.generate("", u.c);
    assert.equal(u.launches.length, 0);
    const yes = uiEnv(root, { select: (o) => o[1] });
    await GENERATE_HANDLERS.generate("", yes.c);
    assert.equal(yes.launches[0].args[0], "rebuild");
    const catchUp = uiEnv(root, { select: (o) => o[0] });
    await GENERATE_HANDLERS.generate("", catchUp.c);
    assert.equal(catchUp.launches[0].args[0], "catchup");
    assert.match(reviewText({ ...newJob("rebuild", "m"), kind: "rebuild" }, []), /moves the current memory/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
