import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// /studio opens Topology studio for the project Pi is running in.
// /studio stop shuts it down. The server and its tailnet lease live as long as this Pi session.

const STUDIO_DIR = process.env.TOPOLOGY_STUDIO_DIR ?? path.join(homedir(), "dev/personal/tools/topology-studio");
const READY = /Topology studio: (http:\/\/127\.0\.0\.1:(\d+)\/\?token=[a-f0-9]+)/;
const LEASE = /(https:\/\/\S+\.ts\.net:\d+)/;
const START_TIMEOUT_MS = 5 * 60_000;

type Running = { project: string; url: string; tailnet?: string; server: ChildProcess; lease?: ChildProcess };

function waitFor(child: ChildProcess, pattern: RegExp, timeoutMs: number): Promise<RegExpMatchArray> {
  return new Promise((resolve, reject) => {
    let output = "";
    const done = (fn: () => void) => { clearTimeout(timer); child.stdout?.off("data", onData); child.stderr?.off("data", onData); child.off("exit", onExit); fn(); };
    const onData = (chunk: Buffer) => { output += chunk.toString(); const m = output.match(pattern); if (m) done(() => resolve(m)); };
    const onExit = (code: number | null) => done(() => reject(new Error(output.trim().split("\n").slice(-3).join("\n") || `exited with code ${code}`)));
    const timer = setTimeout(() => done(() => reject(new Error("timed out"))), timeoutMs);
    child.stdout?.on("data", onData); child.stderr?.on("data", onData); child.once("exit", onExit);
  });
}

export default function topologyStudio(pi: ExtensionAPI) {
  let running: Running | null = null;

  const stop = () => {
    running?.lease?.kill("SIGINT");
    running?.server.kill("SIGTERM");
    running = null;
  };

  pi.on("session_shutdown", async () => { stop(); });

  pi.registerCommand("studio", {
    description: "Open Topology studio for this project (/studio stop to close)",
    getArgumentCompletions: (prefix) => ("stop".startsWith(prefix) ? [{ value: "stop", label: "stop" }] : null),
    handler: async (args, ctx) => {
      if (args.trim() === "stop") {
        if (!running) return ctx.ui.notify("Topology studio is not running", "info");
        stop();
        return ctx.ui.notify("Topology studio stopped", "info");
      }

      const project = ctx.cwd;
      if (running?.project === project && running.server.exitCode === null) {
        spawn("open", [running.url], { stdio: "ignore" }).on("error", () => {});
        return ctx.ui.notify(`Topology studio: ${running.url}${running.tailnet ? `\nTailnet: ${running.tailnet}` : ""}`, "info");
      }
      stop();

      if (!existsSync(path.join(STUDIO_DIR, "bin/studio.js"))) {
        return ctx.ui.notify(`Topology studio not found at ${STUDIO_DIR}. Set TOPOLOGY_STUDIO_DIR.`, "error");
      }
      if (!existsSync(path.join(project, ".pi/workflows"))) {
        ctx.ui.notify(`No .pi/workflows in ${project}. The studio will open with an empty list.`, "warning");
      }

      ctx.ui.notify(`Starting Topology studio for ${path.basename(project)}…`, "info");
      const server = spawn(process.execPath, ["bin/studio.js", "--project", project, "--no-open"], {
        cwd: STUDIO_DIR, stdio: ["ignore", "pipe", "pipe"],
      });
      let url: string, port: string;
      try {
        [, url, port] = await waitFor(server, READY, START_TIMEOUT_MS);
      } catch (e) {
        server.kill("SIGTERM");
        return ctx.ui.notify(`Topology studio failed to start: ${(e as Error).message}`, "error");
      }
      running = { project, url, server };
      server.once("exit", () => { if (running?.server === server) { running.lease?.kill("SIGINT"); running = null; } });
      spawn("open", [url], { stdio: "ignore" }).on("error", () => {});

      // Best effort: expose it on the tailnet through the local web gateway.
      let tailnet: string | undefined;
      const lease = spawn("local-web-gateway", ["expose", "--url", `http://127.0.0.1:${port}`, "--name", `Topology studio · ${path.basename(project)}`, "--description", project], { stdio: ["ignore", "pipe", "pipe"] });
      lease.on("error", () => {});
      try {
        const [, origin] = await waitFor(lease, LEASE, 20_000);
        tailnet = `${origin}/${new URL(url).search}`;
        running.lease = lease; running.tailnet = tailnet;
      } catch { lease.kill("SIGINT"); }

      ctx.ui.notify(`Topology studio: ${url}${tailnet ? `\nTailnet: ${tailnet}` : ""}`, "info");
    },
  });
}
