import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { applyEdits, buildModel, validate, type Step } from "../lib/parse.js";
import { ConflictError, scaffold, Store } from "../lib/store.js";

const fixture = (n: string) => readFileSync(join(import.meta.dirname, "fixtures", `${n}.js`), "utf8");

function flat(steps: Step[]): Step[] {
	return steps.flatMap((s) => [s, ...(s.kind === "loop" || s.kind === "if" ? [...flat(s.steps), ...flat(s.kind === "if" ? s.elseSteps : [])] : []), ...(s.kind === "parallel" ? s.branches : [])]);
}

test("plan.js: meta, schema, loop, agents", () => {
	const m = buildModel(fixture("plan"));
	assert.equal(m.meta?.name, "plan");
	assert.deepEqual(m.meta?.phases, ["Plan", "Challenge", "Explain"]);
	assert.deepEqual(m.schemas.map((s) => s.name), ["VERDICT"]);
	const all = flat(m.steps);
	assert.ok(all.some((s) => s.kind === "loop"));
	const labels = all.filter((s) => s.kind === "agent").map((s) => (s as { label: string }).label);
	assert.ok(labels.length >= 4);
	const oracle = all.find((s) => s.kind === "agent" && s.agentType === "oracle");
	assert.equal(oracle?.kind === "agent" && oracle.schema, "VERDICT");
});

test("build.js: parallel branches and nested loop", () => {
	const m = buildModel(fixture("build"));
	const all = flat(m.steps);
	const par = all.find((s) => s.kind === "parallel");
	assert.equal(par?.kind === "parallel" && par.branches.length, 2);
	assert.ok(par?.kind === "parallel" && par.branches.every((b) => b.kind === "agent" && b.agentType === "reviewer"));
	assert.deepEqual(m.schemas.map((s) => s.name), ["FIXES", "QA"]);
});

test("prompt splice keeps file valid and untouched elsewhere", () => {
	const src = fixture("plan");
	const m = buildModel(src);
	const a = flat(m.steps).find((s) => s.kind === "agent" && s.prompt?.mode === "template" && s.agentType === "lead");
	assert.ok(a?.kind === "agent" && a.prompt);
	const next = applyEdits(src, [{ start: a.prompt.editStart, end: a.prompt.editEnd, text: "NEW PROMPT ${dir}" }]);
	validate(next);
	assert.ok(next.includes("NEW PROMPT ${dir}"));
	assert.equal(next.length - src.length, "NEW PROMPT ${dir}".length - a.prompt.text.length);
});

test("overlapping edits are rejected", () => {
	assert.throws(() => applyEdits("abcdef", [{ start: 0, end: 4, text: "" }, { start: 2, end: 5, text: "" }]), /Overlapping/);
});

test("scaffold is valid and parses", () => {
	const s = scaffold("demo");
	validate(s);
	assert.ok(flat(buildModel(s).steps).some((x) => x.kind === "parallel"));
});

test("store: safe names, conflict, shadowing", () => {
	const cwd = mkdtempSync(join(tmpdir(), "topo-"));
	mkdirSync(join(cwd, ".pi", "workflows"), { recursive: true });
	mkdirSync(join(cwd, ".agents", "workflows"), { recursive: true });
	writeFileSync(join(cwd, ".pi", "workflows", "a.js"), scaffold("a"));
	writeFileSync(join(cwd, ".agents", "workflows", "a.js"), scaffold("a"));
	const store = new Store(cwd);
	const list = store.list().filter((w) => w.scope !== "user");
	assert.equal(list.find((w) => w.scope === "agents")?.shadowedBy, "project");
	assert.throws(() => store.pathOf({ scope: "project", name: "../x" }), /not a usable/);
	const { hash } = store.read({ scope: "project", name: "a" });
	store.write({ scope: "project", name: "a" }, scaffold("a") + "// x\n", hash);
	assert.throws(() => store.write({ scope: "project", name: "a" }, scaffold("a"), hash), ConflictError);
	assert.throws(() => store.write({ scope: "project", name: "b" }, "const x = 1", null), /meta/);
});
