import assert from "node:assert/strict";
import test from "node:test";
import { fixture } from "../../../herdr-ui/tests/fixtures.mjs";

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

test("auto-links only an actually missing bundled Herdr pane", async (t) => {
	const f = fixture(t, { pluginMissing: true }, { HERDR_ENV: "1", HERDR_PANE_ID: "w1:p1", VISUAL: "nvim -f" });
	const { pi } = fakePi([]);
	const target = await launchSkillEditor(pi, skillPath, { env: f.env, platform: "darwin", pluginRoot: "/tmp/viewer" });
	assert.equal(target, "Herdr popup");
	const calls = f.calls();
	assert.deepEqual(calls[2].args, ["plugin", "link", "/tmp/viewer"]);
	assert.ok(calls[1].args.includes("PI_EXT_SKILL_PATH=/tmp/example skill/SKILL.md"));
	assert.ok(calls[1].args.includes("PI_EXT_SKILL_EDITOR=nvim -f"));
});

test("lets the Herdr pane choose nvim or vi when no editor is configured", async (t) => {
	const f = fixture(t, {}, { HERDR_ENV: "1", HERDR_PANE_ID: "w1:p1", VISUAL: undefined, EDITOR: undefined });
	await launchSkillEditor(fakePi([]).pi, skillPath, { env: f.env, platform: "linux" });
	assert.equal(f.calls()[1].args.some(arg => arg.startsWith("PI_EXT_SKILL_EDITOR=")), false);
});

test("stale Herdr context does not fall through to tmux or desktop terminals", async (t) => {
	const f = fixture(t, {}, { HERDR_ENV: "1", HERDR_PANE_ID: "missing", TMUX: "outer" });
	const { pi, calls } = fakePi([ok]);
	await assert.rejects(launchSkillEditor(pi, skillPath, { env: f.env, platform: "darwin" }), /stale_context/);
	assert.deepEqual(calls, []);
});

test("app caller opens a caller-space tab and never execs a desktop terminal", async (t) => {
	const f = fixture(t, {}, { HC_TERMINAL_ID: "t1", VISUAL: "nvim -f" });
	const { pi, calls } = fakePi([ok, ok, ok]);
	for (const platform of ["darwin", "linux"]) {
		const target = await launchSkillEditor(pi, skillPath, { env: f.env, platform, pluginRoot: "/tmp/viewer" });
		assert.equal(target, "Herdr tab");
	}
	assert.deepEqual(calls, []);
	const created = f.calls().filter(x => x.args[0] === "do");
	assert.deepEqual(created.map(x => x.args[1]), ["tab.new", "tab.new"]);
	const request = JSON.parse(created[0].args[2]);
	assert.equal(request.space, "sp1");
	assert.equal(request.folder, "/tmp/example skill");
	assert.equal(request.name, "Skill: example skill");
	assert.ok(request.argv.includes("PI_EXT_SKILL_PATH=/tmp/example skill/SKILL.md"));
	assert.equal(request.argv.at(-1), "/tmp/viewer/open-skill.sh");
	assert.equal(f.calls().some(x => ["status", "plugin"].includes(x.args[0]) || x.args[1] === "terminal.peek" || x.args[1] === "overlay.close"), false);
});

test("app adapter errors surface without Ghostty, osascript or tmux fallback", async (t) => {
	for (const [config, code] of [[{ listing: { spaces: [] } }, /stale_context|Reopen/], [{ fail: "herdr-app do" }, /:/]]) {
		const f = fixture(t, config, { HC_TERMINAL_ID: "t1", TMUX: "outer" });
		const { pi, calls } = fakePi([ok, ok, ok]);
		await assert.rejects(launchSkillEditor(pi, skillPath, { env: f.env, platform: "darwin" }), code);
		assert.deepEqual(calls, []);
	}
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
