import { parse } from "acorn";

/** Loose acorn node: the walker only reads `type`, `start`, `end` and children. */
// biome-ignore lint/suspicious/noExplicitAny: acorn nodes are untyped trees
type N = any;

export interface Prop {
	start: number;
	end: number;
	valueStart: number;
	valueEnd: number;
	src: string;
}

export interface AgentFields {
	/** Region the prompt editor shows and replaces. */
	prompt: { editStart: number; editEnd: number; text: string; mode: "template" | "expr"; start: number; end: number } | null;
	/** Options object literal, when present. */
	opts: { start: number; end: number; lastPropEnd: number | null } | null;
	props: Record<string, Prop>;
	label: string;
	agentType: string;
	schema: string;
}

interface Base {
	id: string;
	/** Byte range this step owns (whole lines for statements, the arrow for branches). */
	start: number;
	end: number;
	indent: string;
	refs: string[];
}

export type Step =
	| (Base & { kind: "phase"; title: string })
	| (Base & { kind: "log"; text: string })
	| (Base & { kind: "return"; text: string })
	| (Base & { kind: "code"; text: string })
	| (Base & AgentFields & { kind: "agent"; bind: string | null; branch: boolean })
	| (Base & { kind: "parallel"; bind: string | null; branches: Step[] })
	| (Base & { kind: "loop"; header: string; steps: Step[] })
	| (Base & { kind: "if"; test: string; steps: Step[]; elseSteps: Step[] });

export interface Model {
	meta: { name: string; description: string; phases: string[]; start: number; end: number } | null;
	schemas: { name: string; src: string }[];
	steps: Step[];
	warnings: string[];
}

const OPTS = {
	ecmaVersion: "latest",
	sourceType: "module",
	allowAwaitOutsideFunction: true,
	allowReturnOutsideFunction: true,
} as const;

export function hasMeta(source: string): boolean {
	return /export\s+const\s+meta\s*=/.test(source);
}

/** Throws a readable error when the source cannot be run as a workflow. */
export function validate(source: string): void {
	try {
		parse(source, OPTS);
	} catch (error) {
		throw new Error(`Syntax error: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (!hasMeta(source)) throw new Error("Missing `export const meta = { name, description }` declaration");
}

function walkIdentifiers(node: N, out: Set<string>): void {
	if (!node || typeof node !== "object") return;
	if (Array.isArray(node)) {
		for (const child of node) walkIdentifiers(child, out);
		return;
	}
	if (node.type === "Identifier") out.add(node.name);
	for (const key of Object.keys(node)) {
		if (key === "type" || key === "start" || key === "end") continue;
		const value = node[key];
		if (value && typeof value === "object") walkIdentifiers(value, out);
	}
}

function refsOf(node: N, exclude?: string | null): string[] {
	const out = new Set<string>();
	walkIdentifiers(node, out);
	if (exclude) out.delete(exclude);
	return [...out];
}

function literalString(node: N | undefined): string {
	if (!node) return "";
	if (node.type === "Literal" && typeof node.value === "string") return node.value;
	if (node.type === "TemplateLiteral" && node.expressions.length === 0) return node.quasis[0].value.cooked ?? "";
	return "";
}

function firstLine(text: string): string {
	const line = text.split("\n").find((l) => l.trim() !== "") ?? "";
	return line.trim().slice(0, 140);
}

class Builder {
	private counter = 0;
	constructor(private readonly source: string) {}

	private nextId(): string {
		return `s${this.counter++}`;
	}

	private lineExtent(start: number, end: number): { start: number; end: number; indent: string } {
		const s = this.source;
		let ls = s.lastIndexOf("\n", start - 1) + 1;
		const lead = s.slice(ls, start);
		if (lead.trim() !== "") ls = start;
		let le = s.indexOf("\n", end);
		le = le < 0 ? s.length : le + 1;
		return { start: ls, end: le, indent: ls === start ? "" : lead };
	}

	private unwrap(expr: N): N {
		let node = expr;
		for (;;) {
			if (node?.type === "AwaitExpression") node = node.argument;
			else if (
				node?.type === "CallExpression" &&
				node.callee.type === "MemberExpression" &&
				!node.callee.computed &&
				["then", "catch", "finally"].includes(node.callee.property.name)
			) {
				node = node.callee.object;
			} else return node;
		}
	}

	private agentFields(call: N): AgentFields {
		const src = this.source;
		const [promptNode, optsNode] = call.arguments as N[];
		let prompt: AgentFields["prompt"] = null;
		if (promptNode) {
			const template = promptNode.type === "TemplateLiteral";
			const editStart = template ? promptNode.start + 1 : promptNode.start;
			const editEnd = template ? promptNode.end - 1 : promptNode.end;
			prompt = {
				editStart,
				editEnd,
				text: src.slice(editStart, editEnd),
				mode: template ? "template" : "expr",
				start: promptNode.start,
				end: promptNode.end,
			};
		}
		const props: Record<string, Prop> = {};
		let opts: AgentFields["opts"] = null;
		if (optsNode?.type === "ObjectExpression") {
			let lastPropEnd: number | null = null;
			for (const p of optsNode.properties as N[]) {
				lastPropEnd = p.end;
				if (p.type !== "Property" || p.computed) continue;
				const key = p.key.name ?? p.key.value;
				props[String(key)] = {
					start: p.start,
					end: p.end,
					valueStart: p.value.start,
					valueEnd: p.value.end,
					src: src.slice(p.value.start, p.value.end),
				};
			}
			opts = { start: optsNode.start, end: optsNode.end, lastPropEnd };
		}
		const pretty = (key: string) => {
			const v = props[key]?.src ?? "";
			return /^(['"`]).*\1$/s.test(v) ? v.slice(1, -1) : v;
		};
		return { prompt, opts, props, label: pretty("label"), agentType: pretty("agentType"), schema: pretty("schema") };
	}

	private bindOf(stmt: N): { expr: N; bind: string | null } {
		if (stmt.type === "VariableDeclaration" && stmt.declarations.length === 1 && stmt.declarations[0].init) {
			const d = stmt.declarations[0];
			return { expr: d.init, bind: d.id.type === "Identifier" ? d.id.name : null };
		}
		if (stmt.type === "ExpressionStatement") {
			const e = stmt.expression;
			if (e.type === "AssignmentExpression" && e.operator === "=") {
				return { expr: e.right, bind: e.left.type === "Identifier" ? e.left.name : null };
			}
			return { expr: e, bind: null };
		}
		return { expr: null, bind: null };
	}

	private branch(fn: N): Step {
		const call = fn.type === "ArrowFunctionExpression" || fn.type === "FunctionExpression" ? this.bodyCall(fn) : null;
		const base: Base = { id: this.nextId(), start: fn.start, end: fn.end, indent: "", refs: refsOf(fn) };
		if (call?.callee?.type === "Identifier" && call.callee.name === "agent") {
			return { ...base, kind: "agent", bind: null, branch: true, ...this.agentFields(call) };
		}
		return { ...base, kind: "code", text: firstLine(this.source.slice(fn.start, fn.end)) };
	}

	private bodyCall(fn: N): N | null {
		if (fn.body.type !== "BlockStatement") return this.unwrap(fn.body);
		const only = fn.body.body.length === 1 ? fn.body.body[0] : null;
		if (only?.type === "ReturnStatement" && only.argument) return this.unwrap(only.argument);
		return null;
	}

	private block(node: N): Step[] {
		return node.type === "BlockStatement" ? this.steps(node.body) : [this.code(node)];
	}

	private code(stmt: N): Step {
		const ext = this.lineExtent(stmt.start, stmt.end);
		return {
			id: this.nextId(),
			...ext,
			refs: refsOf(stmt),
			kind: "code",
			text: firstLine(this.source.slice(stmt.start, stmt.end)),
		};
	}

	step(stmt: N): Step {
		const src = this.source;
		const ext = this.lineExtent(stmt.start, stmt.end);
		const mk = (): Base => ({ id: this.nextId(), ...ext, refs: refsOf(stmt) });

		if (["ForStatement", "WhileStatement", "DoWhileStatement", "ForOfStatement", "ForInStatement"].includes(stmt.type)) {
			const header =
				stmt.type === "DoWhileStatement"
					? `do … while (${src.slice(stmt.test.start, stmt.test.end)})`
					: src.slice(stmt.start, stmt.body.start).trim();
			const base = mk();
			return { ...base, kind: "loop", header, steps: this.block(stmt.body) };
		}
		if (stmt.type === "IfStatement" && stmt.consequent.type === "BlockStatement") {
			const base = mk();
			return {
				...base,
				kind: "if",
				test: src.slice(stmt.test.start, stmt.test.end),
				steps: this.block(stmt.consequent),
				elseSteps: stmt.alternate ? this.block(stmt.alternate) : [],
			};
		}
		if (stmt.type === "ReturnStatement") {
			return { ...mk(), kind: "return", text: firstLine(src.slice(stmt.start, stmt.end)) };
		}

		const { expr, bind } = this.bindOf(stmt);
		const call = expr ? this.unwrap(expr) : null;
		if (call?.type === "CallExpression" && call.callee.type === "Identifier") {
			const name = call.callee.name as string;
			if (name === "agent") {
				return { ...mk(), kind: "agent", bind, branch: false, ...this.agentFields(call) };
			}
			if (name === "parallel" && call.arguments[0]?.type === "ArrayExpression") {
				const base = mk();
				const branches = (call.arguments[0].elements as N[]).filter(Boolean).map((el) => this.branch(el));
				return { ...base, kind: "parallel", bind, branches };
			}
			if (name === "phase") return { ...mk(), kind: "phase", title: literalString(call.arguments[0]) };
			if (name === "log") return { ...mk(), kind: "log", text: firstLine(src.slice(call.start, call.end)) };
		}
		return this.code(stmt);
	}

	steps(stmts: N[]): Step[] {
		return stmts.map((s) => this.step(s));
	}
}

function metaOf(node: N): Model["meta"] {
	const decl = node.declaration?.declarations?.[0];
	if (decl?.id?.name !== "meta" || decl.init?.type !== "ObjectExpression") return null;
	let name = "";
	let description = "";
	const phases: string[] = [];
	for (const p of decl.init.properties as N[]) {
		if (p.type !== "Property") continue;
		const key = p.key.name ?? p.key.value;
		if (key === "name") name = literalString(p.value);
		else if (key === "description") description = literalString(p.value);
		else if (key === "phases" && p.value.type === "ArrayExpression") {
			for (const el of p.value.elements as N[]) {
				const title = el?.properties?.find((q: N) => (q.key.name ?? q.key.value) === "title");
				if (title) phases.push(literalString(title.value));
			}
		}
	}
	return { name, description, phases, start: node.start, end: node.end };
}

function isSchemaDecl(stmt: N): boolean {
	if (stmt.type !== "VariableDeclaration" || stmt.declarations.length !== 1) return false;
	const d = stmt.declarations[0];
	return (
		d.id.type === "Identifier" &&
		d.init?.type === "ObjectExpression" &&
		d.init.properties.some((p: N) => p.type === "Property" && (p.key.name ?? p.key.value) === "type")
	);
}

export function buildModel(source: string): Model {
	const warnings: string[] = [];
	let program: N;
	try {
		program = parse(source, OPTS);
	} catch (error) {
		return { meta: null, schemas: [], steps: [], warnings: [`Syntax error: ${error instanceof Error ? error.message : String(error)}`] };
	}
	const builder = new Builder(source);
	let meta: Model["meta"] = null;
	const schemas: Model["schemas"] = [];
	const body: N[] = [];
	for (const stmt of program.body as N[]) {
		if (stmt.type === "ExportNamedDeclaration" && !meta) {
			meta = metaOf(stmt);
			if (meta) continue;
		}
		if (isSchemaDecl(stmt)) {
			schemas.push({ name: stmt.declarations[0].id.name, src: source.slice(stmt.start, stmt.end) });
			continue;
		}
		body.push(stmt);
	}
	if (!meta) warnings.push("No `export const meta = {…}` found; the runner will refuse this file.");
	return { meta, schemas, steps: builder.steps(body), warnings };
}

export interface Edit {
	start: number;
	end: number;
	text: string;
}

/** Applies non-overlapping splices against `source`. Throws on overlap or bad ranges. */
export function applyEdits(source: string, edits: Edit[]): string {
	const sorted = [...edits].sort((a, b) => b.start - a.start || b.end - a.end);
	let out = source;
	let floor = Number.POSITIVE_INFINITY;
	for (const e of sorted) {
		if (!Number.isInteger(e.start) || !Number.isInteger(e.end) || e.start < 0 || e.end < e.start || e.end > source.length) {
			throw new Error("Invalid edit range");
		}
		if (e.end > floor) throw new Error("Overlapping edits");
		floor = e.start;
		out = out.slice(0, e.start) + e.text + out.slice(e.end);
	}
	return out;
}
