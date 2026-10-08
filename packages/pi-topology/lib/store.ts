import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { hasMeta, validate } from "./parse.js";

export type Scope = "project" | "agents" | "user";

export interface WorkflowRef {
	scope: Scope;
	name: string;
}

export interface WorkflowInfo extends WorkflowRef {
	path: string;
	/** Name of a higher-priority scope that defines the same workflow name. */
	shadowedBy: Scope | null;
	runnable: boolean;
	description: string;
}

const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function isSafeName(name: string): boolean {
	return SAFE_NAME.test(name) && !name.includes("..");
}

export function sha(source: string): string {
	return createHash("sha1").update(source).digest("hex");
}

function agentDir(): string {
	return process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
}

/** Same roots, same priority, as the subagent runner's saved-workflow lookup. */
export function rootsFor(cwd: string): Record<Scope, string> {
	return {
		project: join(cwd, ".pi", "workflows"),
		agents: join(cwd, ".agents", "workflows"),
		user: join(agentDir(), "workflows"),
	};
}

const PRIORITY: Scope[] = ["project", "agents", "user"];

function isRealFile(path: string): boolean {
	try {
		const st = lstatSync(path);
		return st.isFile() && !st.isSymbolicLink();
	} catch {
		return false;
	}
}

function isRealDir(path: string): boolean {
	try {
		const st = lstatSync(path);
		return st.isDirectory() && !st.isSymbolicLink();
	} catch {
		return false;
	}
}

function describe(source: string): string {
	const m = /description\s*:\s*(['"`])((?:\\.|(?!\1).)*)\1/s.exec(source);
	return m?.[2] ?? "";
}

export class Store {
	constructor(readonly cwd: string) {}

	roots(): Record<Scope, string> {
		return rootsFor(this.cwd);
	}

	pathOf(ref: WorkflowRef): string {
		if (!PRIORITY.includes(ref.scope)) throw new Error("Unknown scope");
		if (!isSafeName(ref.name)) throw new Error(`"${ref.name}" is not a usable workflow name (letters, digits, dots, hyphens, underscores)`);
		return join(this.roots()[ref.scope], `${ref.name}.js`);
	}

	list(): WorkflowInfo[] {
		const roots = this.roots();
		const seen = new Map<string, Scope>();
		const out: WorkflowInfo[] = [];
		for (const scope of PRIORITY) {
			const root = roots[scope];
			if (!isRealDir(root)) continue;
			for (const file of readdirSync(root).sort()) {
				if (!file.endsWith(".js")) continue;
				const name = file.slice(0, -3);
				const path = join(root, file);
				if (!isSafeName(name) || !isRealFile(path)) continue;
				const source = readFileSync(path, "utf8");
				out.push({
					scope,
					name,
					path,
					shadowedBy: seen.get(name) ?? null,
					runnable: hasMeta(source),
					description: describe(source),
				});
				if (!seen.has(name)) seen.set(name, scope);
			}
		}
		return out;
	}

	read(ref: WorkflowRef): { source: string; hash: string; path: string } {
		const path = this.pathOf(ref);
		if (!isRealFile(path)) throw new Error("Workflow not found");
		const source = readFileSync(path, "utf8");
		return { source, hash: sha(source), path };
	}

	/** Validates, checks the file did not change underneath us, then writes atomically. */
	write(ref: WorkflowRef, source: string, expectedHash: string | null): { hash: string } {
		validate(source);
		const path = this.pathOf(ref);
		if (expectedHash !== null) {
			if (!isRealFile(path)) throw new Error("Workflow no longer exists");
			const current = sha(readFileSync(path, "utf8"));
			if (current !== expectedHash) throw new ConflictError();
		} else if (existsSync(path)) {
			throw new Error(`${ref.name}.js already exists in ${ref.scope}`);
		}
		mkdirSync(this.roots()[ref.scope], { recursive: true });
		const tmp = `${path}.${process.pid}.tmp`;
		writeFileSync(tmp, source, "utf8");
		renameSync(tmp, path);
		return { hash: sha(source) };
	}

	remove(ref: WorkflowRef): void {
		const path = this.pathOf(ref);
		if (!isRealFile(path)) throw new Error("Workflow not found");
		unlinkSync(path);
	}

	/** Agent roles a workflow can name in `agentType`. */
	agentTypes(): string[] {
		const names = new Set<string>(["general-purpose", "Explore", "Plan"]);
		for (const dir of [join(agentDir(), "agents"), join(this.cwd, ".agents", "agents"), join(this.cwd, ".pi", "agents")]) {
			if (!isRealDir(dir)) continue;
			for (const f of readdirSync(dir)) if (f.endsWith(".md")) names.add(f.slice(0, -3));
		}
		return [...names].sort();
	}
}

export class ConflictError extends Error {
	constructor() {
		super("The file changed on disk since you opened it. Reload to continue.");
	}
}

export function scaffold(name: string): string {
	return `export const meta = {
  name: '${name}',
  description: 'Describe what this workflow does',
  phases: [{ title: 'Work' }, { title: 'Review' }],
}

// args: { task: string }
const task = args?.task
if (!task) throw new Error('${name} needs args.task')

phase('Work')
const result = await agent(
  \`Do this task:\\n\${task}\`,
  { agentType: 'general-purpose', label: 'worker' },
)

phase('Review')
const reviews = await parallel([
  () => agent(\`Review for correctness:\\n\${result}\`, { agentType: 'general-purpose', label: 'reviewer-a', phase: 'Review' }),
  () => agent(\`Review for design:\\n\${result}\`, { agentType: 'general-purpose', label: 'reviewer-b', phase: 'Review' }),
])

return { result, reviews }
`;
}
