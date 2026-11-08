import { createHerdrUi } from "@iurysza/herdr-ui";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const EXEC_TIMEOUT_MS = 5000;

const EDITOR_SHELL_SCRIPT = [
	'editor="${VISUAL:-${EDITOR:-}}"',
	'if [ -z "$editor" ]; then if command -v nvim >/dev/null 2>&1; then editor=nvim; else editor=vi; fi; fi',
	'exec $editor "$@"',
].join("; ");

type ExecAPI = Pick<ExtensionAPI, "exec">;
type Platform = NodeJS.Platform;

interface LaunchOptions {
	env?: NodeJS.ProcessEnv;
	platform?: Platform;
	pluginRoot?: string;
}

interface ExecResult {
	code: number;
	stdout: string;
	stderr: string;
}

function pluginRootFromSource(): string {
	return resolve(
		dirname(fileURLToPath(import.meta.url)),
		"herdr",
		"skill-viewer",
	);
}

function editorSpec(env: NodeJS.ProcessEnv): string | undefined {
	return env.VISUAL?.trim() || env.EDITOR?.trim() || undefined;
}

function shellQuote(value: string): string {
	if (value.length === 0) return "''";
	return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function appleScriptString(value: string): string {
	return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", "\\n");
}

async function run(
	pi: ExecAPI,
	command: string,
	args: string[],
): Promise<ExecResult> {
	try {
		return await pi.exec(command, args, { timeout: EXEC_TIMEOUT_MS });
	} catch (error) {
		return {
			code: 1,
			stdout: "",
			stderr: error instanceof Error ? error.message : String(error),
		};
	}
}

async function openTmuxSplit(pi: ExecAPI, skillPath: string): Promise<boolean> {
	const launched = await run(pi, "tmux", [
		"split-window",
		"-h",
		"-c",
		dirname(skillPath),
		"bash",
		"-lc",
		EDITOR_SHELL_SCRIPT,
		"pi-ext-skill-editor",
		skillPath,
	]);
	return launched.code === 0;
}

async function openMacTerminal(pi: ExecAPI, skillPath: string): Promise<string | null> {
	const ghostty = await run(pi, "open", [
		"-na",
		"Ghostty.app",
		"--args",
		"-e",
		"bash",
		"-lc",
		EDITOR_SHELL_SCRIPT,
		"pi-ext-skill-editor",
		skillPath,
	]);
	if (ghostty.code === 0) return "Ghostty window";

	const command = [
		`cd ${shellQuote(dirname(skillPath))}`,
		`bash -lc ${shellQuote(EDITOR_SHELL_SCRIPT)} pi-ext-skill-editor ${shellQuote(skillPath)}`,
	].join(" && ");
	const terminal = await run(pi, "osascript", [
		"-e",
		`tell application "Terminal"\nactivate\ndo script "${appleScriptString(command)}"\nend tell`,
	]);
	return terminal.code === 0 ? "Terminal window" : null;
}

async function openLinuxTerminal(pi: ExecAPI, skillPath: string): Promise<string | null> {
	const launches: Array<[string, string[], string]> = [
		[
			"x-terminal-emulator",
			["-e", "bash", "-lc", EDITOR_SHELL_SCRIPT, "pi-ext-skill-editor", skillPath],
			"terminal window",
		],
		[
			"gnome-terminal",
			["--", "bash", "-lc", EDITOR_SHELL_SCRIPT, "pi-ext-skill-editor", skillPath],
			"GNOME Terminal window",
		],
		[
			"kitty",
			["--detach", "--directory", dirname(skillPath), "bash", "-lc", EDITOR_SHELL_SCRIPT, "pi-ext-skill-editor", skillPath],
			"Kitty window",
		],
	];

	for (const [command, args, label] of launches) {
		if ((await run(pi, command, args)).code === 0) return label;
	}
	return null;
}

export async function launchSkillEditor(
	pi: ExecAPI,
	skillPath: string,
	options: LaunchOptions = {},
): Promise<string> {
	const env = options.env ?? process.env;
	const platform = options.platform ?? process.platform;
	const pluginRoot = options.pluginRoot ?? pluginRootFromSource();

	// Inside any Herdr (app or legacy) the shared adapter is the only path:
	// never fall back to tmux or desktop terminal emulators.
	if (env.HC_TERMINAL_ID !== undefined || env.HERDR_ENV === "1") {
		const editor = editorSpec(env);
		const viewer = createHerdrUi({ env }).openViewer({
			cwd: dirname(skillPath),
			name: `Skill: ${basename(dirname(skillPath))}`,
			argv: ["env", `PI_EXT_SKILL_PATH=${skillPath}`, ...(editor ? [`PI_EXT_SKILL_EDITOR=${editor}`] : []), "bash", resolve(pluginRoot, "open-skill.sh")],
			legacy: {
				plugin: "pi-ext-skill-viewer", entrypoint: "skill", root: pluginRoot,
				env: { PI_EXT_SKILL_PATH: skillPath, ...(editor ? { PI_EXT_SKILL_EDITOR: editor } : {}) },
			},
		});
		if (viewer.ok === false) throw new Error(`${viewer.error.code}: ${viewer.error.message}`);
		return viewer.value.placement === "popup" ? "Herdr popup" : viewer.value.placement === "tab" ? "Herdr tab" : "Herdr split";
	}

	if (env.TMUX && await openTmuxSplit(pi, skillPath)) {
		return "tmux split";
	}

	const terminal = platform === "darwin"
		? await openMacTerminal(pi, skillPath)
		: platform === "linux"
			? await openLinuxTerminal(pi, skillPath)
			: null;
	if (terminal) return terminal;

	throw new Error("Unable to open a Herdr popup, tmux split, or terminal window");
}
