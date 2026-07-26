import assert from "node:assert/strict";
import test from "node:test";

import { launchSkillEditor } from "../../extensions/leader-key/skill-editor.ts";

const ok = { code: 0, stdout: "", stderr: "" };
const failed = { code: 1, stdout: "", stderr: "failed" };
const skillPath = "/tmp/example skill/SKILL.md";

function fakePi(results) {
	const calls = [];
	return {
		calls,
		pi: {
			async exec(command, args, options) {
				calls.push({ command, args, options });
				return results.shift() ?? failed;
			},
		},
	};
}

test("auto-links the bundled Herdr pane and retries the popup", async () => {
	const { pi, calls } = fakePi([failed, ok, ok]);
	const target = await launchSkillEditor(pi, skillPath, {
		env: { HERDR_ENV: "1", VISUAL: "nvim -f" },
		platform: "darwin",
		pluginRoot: "/tmp/pi-ext-skill-viewer",
	});

	assert.equal(target, "Herdr popup");
	assert.deepEqual(calls.map((call) => call.command), ["herdr", "herdr", "herdr"]);
	assert.deepEqual(calls[1].args, ["plugin", "link", "/tmp/pi-ext-skill-viewer"]);
	assert.ok(calls[0].args.includes("PI_EXT_SKILL_PATH=/tmp/example skill/SKILL.md"));
	assert.ok(calls[0].args.includes("PI_EXT_SKILL_EDITOR=nvim -f"));
	assert.equal(calls[0].options.timeout, 5000);
});

test("lets the Herdr pane choose nvim or vi when no editor is configured", async () => {
	const { pi, calls } = fakePi([ok]);
	await launchSkillEditor(pi, skillPath, {
		env: { HERDR_ENV: "1" },
		platform: "linux",
		pluginRoot: "/tmp/pi-ext-skill-viewer",
	});

	assert.equal(calls[0].args.some((arg) => arg.startsWith("PI_EXT_SKILL_EDITOR=")), false);
});

test("falls back from Herdr to a tmux split", async () => {
	const { pi, calls } = fakePi([failed, failed, ok]);
	const target = await launchSkillEditor(pi, skillPath, {
		env: { HERDR_ENV: "1", TMUX: "/tmp/tmux" },
		platform: "darwin",
		pluginRoot: "/tmp/pi-ext-skill-viewer",
	});

	assert.equal(target, "tmux split");
	assert.equal(calls.at(-1).command, "tmux");
	assert.deepEqual(calls.at(-1).args.slice(0, 4), [
		"split-window",
		"-h",
		"-c",
		"/tmp/example skill",
	]);
	assert.equal(calls.at(-1).args.at(-1), skillPath);
});

test("opens a new Ghostty window without a multiplexer", async () => {
	const { pi, calls } = fakePi([ok]);
	const target = await launchSkillEditor(pi, skillPath, {
		env: { EDITOR: "/opt/homebrew/bin/nvim" },
		platform: "darwin",
	});

	assert.equal(target, "Ghostty window");
	assert.equal(calls[0].command, "open");
	assert.deepEqual(calls[0].args.slice(0, 5), [
		"-na",
		"Ghostty.app",
		"--args",
		"-e",
		"bash",
	]);
	assert.equal(calls[0].args.at(-1), skillPath);
});

test("uses macOS Terminal when Ghostty is unavailable", async () => {
	const { pi, calls } = fakePi([failed, ok]);
	const target = await launchSkillEditor(pi, skillPath, {
		env: { EDITOR: "vi" },
		platform: "darwin",
	});

	assert.equal(target, "Terminal window");
	assert.equal(calls[1].command, "osascript");
	assert.match(calls[1].args[1], /tell application "Terminal"/);
	assert.match(calls[1].args[1], /SKILL\.md/);
});

test("tries common Linux terminals in order", async () => {
	const { pi, calls } = fakePi([failed, ok]);
	const target = await launchSkillEditor(pi, skillPath, {
		env: {},
		platform: "linux",
	});

	assert.equal(target, "GNOME Terminal window");
	assert.deepEqual(calls.map((call) => call.command), [
		"x-terminal-emulator",
		"gnome-terminal",
	]);
});
