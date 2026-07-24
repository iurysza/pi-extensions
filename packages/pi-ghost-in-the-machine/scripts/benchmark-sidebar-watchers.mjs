#!/usr/bin/env node

import { spawn, execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

function cpuSeconds(value) {
  const parts = value.trim().split(":").map(Number);
  if (parts.some(Number.isNaN)) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] ?? 0;
}

function processStats(pid) {
  const output = execFileSync("ps", ["-p", String(pid), "-o", "rss=,%cpu=,time="], { encoding: "utf8" }).trim();
  const match = output.match(/^(\d+)\s+([\d.]+)\s+(.+)$/);
  if (!match) throw new Error(`could not parse ps output for ${pid}: ${output}`);
  return { rssKiB: Number(match[1]), cpuPercent: Number(match[2]), cpuSeconds: cpuSeconds(match[3]) };
}

function findHerdrServer() {
  const explicit = Number(argument("--server-pid", ""));
  if (Number.isInteger(explicit) && explicit > 0) return explicit;
  const rows = execFileSync("ps", ["-axo", "pid=,command="], { encoding: "utf8" }).split("\n");
  const row = rows.find((line) => /\/herdr server\s*$/.test(line.trim()));
  if (!row) throw new Error("Herdr server not found; pass --server-pid");
  return Number(row.trim().split(/\s+/, 1)[0]);
}

function wait(milliseconds) {
  return new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
}

function waitForExit(child) {
  return new Promise((resolveExit) => child.once("exit", resolveExit));
}

async function measure(name, command, args, env, durationMs, serverPid, countFile, logFile) {
  const child = spawn(command, args, { env, stdio: "ignore" });
  await wait(750);
  if (child.exitCode !== null) throw new Error(`${name} watcher exited during warmup`);

  if (countFile) writeFileSync(countFile, "");
  else child.kill("SIGUSR1");
  const watcherStart = processStats(child.pid);
  const serverStart = processStats(serverPid);
  const samples = [];
  const startedAt = Date.now();
  while (Date.now() - startedAt < durationMs) {
    samples.push(processStats(child.pid));
    await wait(250);
  }
  const watcherEnd = processStats(child.pid);
  const serverEnd = processStats(serverPid);
  child.kill("SIGTERM");
  await waitForExit(child);

  const polls = countFile
    ? readFileSync(countFile, "utf8").split("\n").filter(Boolean).length
    : Number(readFileSync(logFile, "utf8").match(/watcher=stop[^\n]* polls=(\d+)/)?.[1] ?? 0);
  const summary = countFile ? "" : readFileSync(logFile, "utf8").match(/watcher=stop[^\n]*/)?.[0] ?? "";
  const averageCpu = samples.reduce((sum, sample) => sum + sample.cpuPercent, 0) / samples.length;
  const averageRss = samples.reduce((sum, sample) => sum + sample.rssKiB, 0) / samples.length;
  const maxRss = Math.max(...samples.map((sample) => sample.rssKiB));

  return {
    name,
    polls,
    pollsPerSecond: polls / (durationMs / 1000),
    persistentRssMiB: averageRss / 1024,
    maxRssMiB: maxRss / 1024,
    averageCpuPercent: averageCpu,
    watcherCpuSeconds: watcherEnd.cpuSeconds - watcherStart.cpuSeconds,
    herdrCpuSeconds: serverEnd.cpuSeconds - serverStart.cpuSeconds,
    processLaunches: countFile ? polls * 4 : 0,
    summary,
  };
}

function fixed(value, digits = 2) {
  return Number(value).toFixed(digits);
}

const durationSeconds = Number(argument("--seconds", "15"));
const socketPath = resolve(argument("--socket", process.env.HERDR_SOCKET_PATH || join(process.env.HOME, ".config/herdr/herdr.sock")));
const legacyRef = argument("--legacy-ref", "b44bcc2");
const herdrBin = argument("--herdr", join(process.env.HOME, ".local/bin/herdr"));
const outputPath = argument("--output", "");
if (!Number.isFinite(durationSeconds) || durationSeconds < 2) throw new Error("--seconds must be at least 2");

const temporary = mkdtempSync(join(tmpdir(), "ghost-watcher-benchmark-"));
const legacyWatcher = join(temporary, "legacy-watch-sidebar.sh");
const countFile = join(temporary, "legacy-herdr-count.log");
const countingHerdr = join(temporary, "counting-herdr.sh");
const fakeController = join(temporary, "controller.sh");
const legacyLog = join(temporary, "legacy.log");
const nodeLog = join(temporary, "node.log");
const nodePid = join(temporary, "node.pid");
const nodeSocket = join(temporary, "socket-path");
const serverPid = findHerdrServer();

try {
  writeFileSync(legacyWatcher, execFileSync("git", ["show", `${legacyRef}:scripts/watch-sidebar.sh`], { cwd: ROOT }));
  writeFileSync(countingHerdr, `#!/usr/bin/env bash\nprintf '1\\n' >> "${countFile}"\nexec "${herdrBin}" "$@"\n`);
  writeFileSync(fakeController, "#!/usr/bin/env bash\nexit 0\n");
  chmodSync(legacyWatcher, 0o755);
  chmodSync(countingHerdr, 0o755);
  chmodSync(fakeController, 0o755);

  const baseEnv = {
    ...process.env,
    HERDR_ENV: "1",
    HERDR_SOCKET_PATH: socketPath,
    GHOST_CONTROLLER_PATH: fakeController,
    SIDEBAR_POLL_INTERVAL: "0.05",
  };
  const durationMs = durationSeconds * 1000;

  const legacy = await measure(
    "Bash/CLI/JQ",
    "bash",
    [legacyWatcher, legacyLog],
    { ...baseEnv, HERDR_BIN_PATH: countingHerdr },
    durationMs,
    serverPid,
    countFile,
    legacyLog,
  );
  await wait(1000);
  const node = await measure(
    "Node/socket",
    process.execPath,
    [
      join(ROOT, "scripts/sidebar-watcher.mjs"),
      "--socket", socketPath,
      "--log", nodeLog,
      "--pid-file", nodePid,
      "--socket-file", nodeSocket,
      "--controller", fakeController,
    ],
    baseEnv,
    durationMs,
    serverPid,
    undefined,
    nodeLog,
  );

  const report = `# Sidebar watcher performance\n\nEqual ${durationSeconds}s idle windows at a 50ms interval against ${socketPath}. Initial transition-controller work is excluded by a 750ms warmup. Process launches for the legacy watcher are derived from observed Herdr CLI calls: one \`herdr\`, two \`jq\`, and one \`sleep\` per poll.\n\n| Metric | ${legacy.name} | ${node.name} |\n| --- | ---: | ---: |\n| Polls/second | ${fixed(legacy.pollsPerSecond)} | ${fixed(node.pollsPerSecond)} |\n| Persistent RSS | ${fixed(legacy.persistentRssMiB)} MiB | ${fixed(node.persistentRssMiB)} MiB |\n| Max RSS | ${fixed(legacy.maxRssMiB)} MiB | ${fixed(node.maxRssMiB)} MiB |\n| Mean %CPU | ${fixed(legacy.averageCpuPercent)} | ${fixed(node.averageCpuPercent)} |\n| Watcher CPU time | ${fixed(legacy.watcherCpuSeconds, 3)}s | ${fixed(node.watcherCpuSeconds, 3)}s |\n| Herdr CPU-time delta | ${fixed(legacy.herdrCpuSeconds, 3)}s | ${fixed(node.herdrCpuSeconds, 3)}s |\n| Steady-state child launches | ${legacy.processLaunches} | ${node.processLaunches} |\n\nNode watcher summary: \`${node.summary}\`\n\n## Interpretation\n\nThe Node watcher cut its own measured CPU time from ${fixed(legacy.watcherCpuSeconds, 3)}s to ${fixed(node.watcherCpuSeconds, 3)}s and removed ${legacy.processLaunches} short-lived child launches during this ${durationSeconds}-second sample. Stable RSS increased by about ${fixed(node.persistentRssMiB - legacy.persistentRssMiB)} MiB. That is the intended trade: memory stays allocated, while process churn and watcher CPU fall.\n\nDo not claim a Herdr server CPU win from this sample. The whole-server CPU-time delta includes unrelated live Herdr work. Both implementations still ask Herdr to compute \`pane.layout\`; this refactor removes client-side process churn, not server-side polling cost. An upstream sidebar event remains the only way to remove that cost.\n\nThe configured interval is 50ms, but requests never overlap. Live server response latency determines the actual poll rate.\n`;

  if (outputPath) writeFileSync(resolve(outputPath), report);
  process.stdout.write(report);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
