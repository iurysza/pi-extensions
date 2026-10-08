#!/usr/bin/env node
// Manual smoke test against a real Claude Code login. Spends a few requests of the account's usage.
//   npm run smoke:live -- [--model claude-code/claude-sonnet-5]
// Exit codes: 0 passed, 1 failed, 2 Claude Code is missing or not logged in.
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const extension = resolve(dirname(fileURLToPath(import.meta.url)), "../src/index.ts");
const pi = process.env.PI_CLAUDE_CODE_SMOKE_PI ?? "pi";
const claude = process.env.PI_CLAUDE_CODE_COMMAND ?? "claude";
const modelFlag = process.argv.indexOf("--model");
const model = modelFlag > 0 ? process.argv[modelFlag + 1] : "claude-code/claude-sonnet-5";

const auth = spawnSync(claude, ["auth", "status"], { encoding: "utf8", timeout: 15_000 });
let loggedIn = false;
try {
	loggedIn = JSON.parse(auth.stdout).loggedIn === true;
} catch {
	// Reported below.
}
if (!loggedIn) {
	console.error(auth.error ? `Claude Code was not found at ${claude}.` : "Claude Code is not logged in. Run `claude auth login` first.");
	process.exit(2);
}

function runPi(cwd, prompt, extraArgs) {
	const args = ["-ne", "-e", extension, "--no-session", "-nc", "-ns", "-np", "--model", model, "--mode", "json", ...extraArgs, "-p", prompt];
	return new Promise((resolvePi, reject) => {
		const child = spawn(pi, args, { cwd, stdio: ["ignore", "pipe", "inherit"] });
		let stdout = "";
		child.stdout.on("data", (chunk) => (stdout += chunk));
		child.on("error", reject);
		child.on("close", (code) => {
			const end = stdout
				.split("\n")
				.filter(Boolean)
				.map((line) => {
					try {
						return JSON.parse(line);
					} catch {
						return undefined;
					}
				})
				.find((event) => event?.type === "agent_end");
			resolvePi({ code, messages: end?.messages ?? [] });
		});
	});
}

const assistants = (messages) => messages.filter((message) => message.role === "assistant");
const text = (message) => message?.content.filter((block) => block.type === "text").map((block) => block.text).join("") ?? "";
const describe = (message) =>
	message ? `${message.stopReason}${message.errorMessage ? `: ${message.errorMessage}` : ""} (in ${message.usage.input}, out ${message.usage.output}, cache read ${message.usage.cacheRead})` : "no answer";

const checks = [
	{
		name: "text turn",
		async run(cwd) {
			const { messages } = await runPi(cwd, "Reply with exactly: pi-claude-code smoke ok", ["--no-tools"]);
			const last = assistants(messages).at(-1);
			return { ok: last?.stopReason === "stop" && text(last).includes("pi-claude-code smoke ok"), detail: describe(last) };
		},
	},
	{
		name: "tool loop with thinking",
		async run(cwd) {
			const nonce = randomBytes(6).toString("hex");
			writeFileSync(join(cwd, "smoke.txt"), `${nonce}\n`);
			const { messages } = await runPi(cwd, "Use the read tool to read smoke.txt, then reply with its contents only.", ["--tools", "read", "--thinking", "low"]);
			const turns = assistants(messages);
			const called = turns.some((message) => message.content.some((block) => block.type === "toolCall" && block.name === "read"));
			const last = turns.at(-1);
			return { ok: called && last?.stopReason === "stop" && text(last).includes(nonce), detail: `${turns.length} turn(s), read called: ${called}, last ${describe(last)}` };
		},
	},
];

let failed = false;
for (const check of checks) {
	const cwd = mkdtempSync(join(tmpdir(), "pi-claude-code-smoke-"));
	try {
		const { ok, detail } = await check.run(cwd);
		failed ||= !ok;
		console.log(`${ok ? "PASS" : "FAIL"} ${check.name}: ${detail}`);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
}
process.exit(failed ? 1 : 0);
