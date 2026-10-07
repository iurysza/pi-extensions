import { execFile } from "node:child_process";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type RunningServer, startServer } from "./lib/server.js";

function openBrowser(url: string): void {
	const [cmd, ...args] =
		process.platform === "darwin" ? ["open", url] : process.platform === "win32" ? ["cmd", "/c", "start", "", url] : ["xdg-open", url];
	execFile(cmd, args, () => undefined);
}

export default function topology(pi: ExtensionAPI) {
	let running: RunningServer | null = null;
	let runningCwd = "";

	const stop = async () => {
		const current = running;
		running = null;
		await current?.close();
	};

	pi.registerCommand("topology", {
		description: "Open the workflow topology editor for this project's subagent workflows",
		handler: async (args, ctx) => {
			try {
				if (args.trim() === "stop") {
					await stop();
					ctx.ui.notify("Topology editor stopped", "info");
					return;
				}
				// Re-running restarts the server so a new cwd or token never lingers.
				await stop();
				running = await startServer(ctx.cwd);
				runningCwd = ctx.cwd;
				openBrowser(running.url);
				ctx.ui.notify(`Topology editor for ${runningCwd}\n${running.url}\n(/topology stop to shut down)`, "info");
			} catch (error) {
				ctx.ui.notify(`topology: ${error instanceof Error ? error.message : String(error)}`, "error");
			}
		},
	});

	pi.on("session_shutdown", async () => {
		await stop();
	});
}
