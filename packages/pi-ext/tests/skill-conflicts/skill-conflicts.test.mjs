import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { DefaultResourceLoader, SettingsManager } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import skillConflicts, {
	OWNED_SKILLS,
	installSkillViewHook,
	selectSkillConflicts,
} from "../../extensions/skill-conflicts/index.ts";

async function fixture(t) {
	const root = await mkdtemp(join(tmpdir(), "pi-skill-conflicts-"));
	const cwd = join(root, "project");
	const agentDir = join(root, "global");
	const globals = [join(agentDir, "skills"), join(root, ".agents", "skills")];
	await mkdir(cwd, { recursive: true });
	const previous = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = agentDir;
	t.after(async () => {
		if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previous;
		await rm(root, { recursive: true, force: true });
	});
	async function file(path, content = "same skill bytes\n") {
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, content);
		return path;
	}
	const winner = await file(join(cwd, ".agents", "skills", "bro", "SKILL.md"));
	const loser = await file(join(globals[0], "bro", "SKILL.md"));
	return { root, cwd, agentDir, globals, file, winner, loser };
}

function collision(f, extra = {}) {
	return { type: "collision", message: "Skill collision", collision: {
		resourceType: "skill", name: "bro", winnerPath: f.winner, loserPath: f.loser, ...extra,
	} };
}

async function loader(f, result) {
	const instance = new DefaultResourceLoader({
		cwd: f.cwd,
		agentDir: f.agentDir,
		settingsManager: SettingsManager.inMemory(),
		noExtensions: true,
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
		skillsOverride: () => result,
	});
	await instance.reload();
	return instance;
}

function harness(t, mode = "tui") {
	const handlers = new Map();
	const commands = new Map();
	const changes = [];
	const notices = [];
	const state = { toolsExpanded: false, renders: 0, component: undefined, theme: { fg: (_role, text) => text } };
	const ctx = { mode, ui: {
		get theme() { return state.theme; },
		getToolsExpanded: () => state.toolsExpanded,
		notify: (...args) => notices.push(args),
		setWidget(key, factory, options) {
			changes.push({ key, factory, options });
			state.component = factory?.({ requestRender: () => state.renders++ }, state.theme);
		},
	} };
	skillConflicts({
		on: (event, handler) => handlers.set(event, handler),
		registerCommand: (name, definition) => commands.set(name, definition),
		// Message or entry writes are deliberately absent: any call fails the test.
	});
	const stop = () => handlers.get("session_shutdown")({}, ctx);
	t.after(stop);
	return {
		ctx, state, changes, notices, handlers, stop,
		start: () => handlers.get("session_start")({}, ctx),
		toggle: () => commands.get("skill-conflicts").handler("", ctx),
	};
}

describe("owned skill conflict selection", () => {
	it("suppresses identical owned copies without mutating diagnostics or skill objects", async (t) => {
		const f = await fixture(t);
		const diagnostic = collision(f);
		Object.freeze(diagnostic.collision);
		Object.freeze(diagnostic);
		const skill = Object.freeze({ name: "bro", filePath: f.winner });
		const result = Object.freeze({ skills: Object.freeze([skill]), diagnostics: Object.freeze([diagnostic]) });
		const selected = selectSkillConflicts(result, f.globals);
		assert.notEqual(selected.result, result);
		assert.equal(selected.result.skills, result.skills);
		assert.equal(selected.result.skills[0], skill);
		assert.deepEqual(selected.result.diagnostics, []);
		assert.equal(selected.conflicts[0], diagnostic.collision);
		assert.deepEqual(result.diagnostics, [diagnostic]);
	});

	it("leaves unknown names, warnings, errors, payload-free and non-skill collisions visible", async (t) => {
		const f = await fixture(t);
		const diagnostics = [
			collision(f, { name: "not-owned" }),
			collision(f, { resourceType: "prompt" }),
			{ ...collision(f), type: "warning" },
			{ ...collision(f), type: "error" },
			{ type: "collision", message: "Skill bro conflicts" },
		];
		const result = { skills: [], diagnostics };
		assert.equal(selectSkillConflicts(result, f.globals).result, result);
	});

	it("leaves differing bytes and unreadable files visible", async (t) => {
		const f = await fixture(t);
		await f.file(f.loser, "different bytes\n");
		let result = { skills: [], diagnostics: [collision(f)] };
		assert.equal(selectSkillConflicts(result, f.globals).result, result);
		result = { skills: [], diagnostics: [collision(f, { loserPath: join(f.globals[0], "missing", "SKILL.md") })] };
		assert.equal(selectSkillConflicts(result, f.globals).result, result);
	});

	it("requires a lexical global boundary and supports either global side including symlinks", async (t) => {
		const f = await fixture(t);
		for (const other of [
			join(f.cwd, "other", "SKILL.md"),
			join(`${f.globals[0]}-other`, "bro", "SKILL.md"),
		]) {
			await f.file(other);
			const result = { skills: [], diagnostics: [collision(f, { loserPath: other })] };
			assert.equal(selectSkillConflicts(result, f.globals).result, result);
		}
		const canonical = await f.file(join(f.root, "collection", "bro", "SKILL.md"));
		const linked = join(f.globals[1], "bro");
		await mkdir(dirname(linked), { recursive: true });
		await symlink(dirname(canonical), linked);
		const result = { skills: [], diagnostics: [collision(f, {
			winnerPath: join(linked, "SKILL.md"), loserPath: f.winner,
		})] };
		assert.equal(selectSkillConflicts(result, f.globals).conflicts.length, 1);
	});

	it("keeps the catalog explicit and limited to the approved collection", () => {
		assert.deepEqual([...OWNED_SKILLS], [
			"audio-transcribe", "better-ui", "brainstorming", "bro", "chatgpt-imagegen",
			"coding-standards", "deslopify", "domain-modeling", "gemini-tts", "goal",
			"readback", "rephrase", "reply-bro", "setup-goal", "skill-cleaner",
			"strunk-writing-quality", "tech-spec", "technical-writing", "tool-install", "type-breakdown",
		]);
	});
});

describe("real resource loader and extension lifecycle", () => {
	it("passes through before startup, displays remembered conflicts only in TUI, and restores on shutdown", async (t) => {
		const f = await fixture(t);
		const diagnostic = collision(f);
		const warning = { type: "warning", message: "True warning" };
		const error = { type: "error", message: "True error" };
		const instance = await loader(f, { skills: [{ name: "bro", filePath: f.winner }], diagnostics: [diagnostic, warning, error] });
		const original = DefaultResourceLoader.prototype.getSkills;
		const baseline = instance.getSkills();
		Object.freeze(baseline.diagnostics);
		const h = harness(t);
		assert.equal(instance.getSkills().diagnostics, baseline.diagnostics);
		assert.equal(h.changes.length, 0);
		h.start();
		assert.equal(h.changes[0].options.placement, "aboveEditor");
		assert.deepEqual(h.state.component.render(80), ["▸ Skill conflicts · 1"]);
		const selected = instance.getSkills();
		assert.deepEqual(selected.diagnostics, [warning, error]);
		assert.equal(selected.skills, baseline.skills);
		assert.equal(selected.skills[0], baseline.skills[0]);
		assert.equal(selected.skills[0].filePath, f.winner);
		assert.equal(original.call(instance).diagnostics, baseline.diagnostics);
		assert.deepEqual([...h.handlers.keys()], ["session_start", "session_shutdown"]);
		h.stop();
		assert.equal(DefaultResourceLoader.prototype.getSkills, original);
		assert.equal(instance.getSkills().diagnostics, baseline.diagnostics);
		assert.equal(h.changes.at(-1).factory, undefined);
	});

	for (const mode of ["rpc", "json", "print", undefined]) {
		it(`leaves ${mode ?? "unknown"} mode diagnostics and UI untouched`, async (t) => {
			const f = await fixture(t);
			const instance = await loader(f, { skills: [], diagnostics: [collision(f)] });
			const baseline = instance.getSkills();
			const h = harness(t, mode);
			// Explicitly model an older/unknown host with no mode property.
			h.ctx.mode = mode;
			instance.getSkills();
			h.start();
			await h.toggle();
			assert.equal(instance.getSkills().diagnostics, baseline.diagnostics);
			assert.deepEqual(h.changes, []);
			assert.deepEqual(h.notices, []);
		});
	}

	it("refreshes the row when subsequent getters observe changed diagnostics", async (t) => {
		const f = await fixture(t);
		const source = { skills: [], diagnostics: [collision(f)] };
		const instance = await loader(f, source);
		const h = harness(t);
		instance.getSkills();
		h.start();
		source.diagnostics = [];
		await instance.reload();
		instance.getSkills();
		assert.equal(h.state.component, undefined);
		await h.toggle();
		assert.match(h.notices[0][0], /No identical owned skill conflicts/);
		source.diagnostics = [collision(f)];
		await instance.reload();
		instance.getSkills();
		assert.deepEqual(h.state.component.render(80), ["▸ Skill conflicts · 1"]);
	});

	it("tracks Ctrl+O changes, command and normalized mouse clicks without taking focus", async (t) => {
		const f = await fixture(t);
		const instance = await loader(f, { skills: [], diagnostics: [collision(f)] });
		const h = harness(t);
		instance.getSkills();
		h.start();
		const component = h.state.component;
		h.state.toolsExpanded = true;
		let lines = component.render(200);
		assert.ok(lines[0].startsWith("▾"));
		assert.ok(lines.some((line) => line.includes(`Chosen: ${f.winner}`)));
		assert.ok(lines.some((line) => line.includes(`Skipped: ${f.loser}`)));
		await h.toggle();
		assert.equal(component.render(200).length, 1);
		const click = { type: "click", button: "left", x: 2, y: 0, width: 80 };
		assert.deepEqual(component.handleMouse(click), { handled: true, render: true });
		assert.ok(component.render(200).length > 1);
		for (const event of [
			{ ...click, type: "press" }, { ...click, type: "release" },
			{ ...click, button: "right" }, { ...click, y: 1 }, { ...click, x: -1 }, { ...click, x: 80 },
		]) assert.equal(component.handleMouse(event), undefined);
		h.state.toolsExpanded = false;
		assert.equal(component.render(200).length, 1);
		assert.equal(h.state.renders, 2);
	});

	it("starts collapsed even if tools are expanded, handles narrow widths and refreshes the theme", async (t) => {
		const f = await fixture(t);
		const instance = await loader(f, { skills: [], diagnostics: [collision(f)] });
		const h = harness(t);
		h.state.toolsExpanded = true;
		instance.getSkills();
		h.start();
		const component = h.state.component;
		assert.equal(component.render(80).length, 1);
		await h.toggle();
		for (const width of [1, 2, 4, 8, 24, 80]) {
			assert.ok(component.render(width).every((line) => visibleWidth(line) <= width));
		}
		assert.deepEqual(component.render(0), []);
		h.state.theme = { fg: (_role, text) => `\u001b[31m${text}\u001b[0m` };
		component.invalidate();
		assert.match(component.render(80)[0], /\u001b\[31m/);
	});

	it("does not stack hooks across replacement factories or let stale shutdown remove the current hook", async (t) => {
		const f = await fixture(t);
		const instance = await loader(f, { skills: [], diagnostics: [collision(f)] });
		const original = DefaultResourceLoader.prototype.getSkills;
		const first = harness(t);
		const wrapped = DefaultResourceLoader.prototype.getSkills;
		instance.getSkills();
		first.start();
		const second = harness(t);
		assert.equal(DefaultResourceLoader.prototype.getSkills, wrapped);
		instance.getSkills();
		second.start();
		first.stop();
		assert.equal(DefaultResourceLoader.prototype.getSkills, wrapped);
		assert.deepEqual(instance.getSkills().diagnostics, []);
		second.stop();
		assert.equal(DefaultResourceLoader.prototype.getSkills, original);
	});

	it("fails open if widget installation throws", async (t) => {
		const f = await fixture(t);
		const instance = await loader(f, { skills: [], diagnostics: [collision(f)] });
		const baseline = instance.getSkills();
		const h = harness(t);
		h.ctx.ui.setWidget = () => { throw new Error("widget unavailable"); };
		instance.getSkills();
		h.start();
		assert.equal(instance.getSkills().diagnostics, baseline.diagnostics);
	});
});

describe("hook cooperation", () => {
	it("preserves later wrappers on teardown and reuses an enclosed inert hook on reload", () => {
		const result = { skills: [], diagnostics: [] };
		const prototype = { getSkills() { assert.equal(this.marker, "receiver"); return result; } };
		const instance = Object.assign(Object.create(prototype), { marker: "receiver" });
		let calls = 0;
		const first = installSkillViewHook(prototype, (value) => { calls++; return value; });
		const inner = prototype.getSkills;
		const outer = function () { return inner.call(this); };
		prototype.getSkills = outer;
		assert.equal(instance.getSkills(), result);
		first.dispose();
		assert.equal(prototype.getSkills, outer);
		assert.equal(instance.getSkills(), result);
		assert.equal(calls, 1);
		const second = installSkillViewHook(prototype, (value) => { calls++; return value; });
		assert.equal(prototype.getSkills, outer);
		assert.equal(instance.getSkills(), result);
		assert.equal(calls, 2);
		second.dispose();
		assert.equal(prototype.getSkills, outer);
	});

	it("fails open when a diagnostic view throws", () => {
		const result = { skills: [], diagnostics: [{ type: "error", message: "Keep me" }] };
		const original = () => result;
		const prototype = { getSkills: original };
		const hook = installSkillViewHook(prototype, () => { throw new Error("view failed"); });
		assert.equal(prototype.getSkills(), result);
		hook.dispose();
		assert.equal(prototype.getSkills, original);
	});
});
