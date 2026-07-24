/**
 * Handoff extension — transfer context to a new pi session in a split or tab.
 *
 * Works with herder, tmux, or cmux. Detects which multiplexer is active automatically.
 *
 * Uses pi-vcc's algorithmic compaction (no LLM calls) to generate a
 * context summary, plus algorithmic extraction of git state, working files,
 * and language detection. Opens a fresh pi session that has the summary + goal
 * as its initial prompt.
 *
 * Includes current tasks from pi-tasks in the handoff prompt.
 *
 * Usage:
 *   /handoff now implement this for teams as well
 *   /handoff check other places that need this fix
 *   /handoff --tab continue in a new tab/window
 */

import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import { convertToLlm } from "@earendil-works/pi-coding-agent";
import { matchesKey, Key } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { existsSync, readFileSync, mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import * as path from "node:path";
import { join, dirname, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { OverlayFrame } from "../shared/overlay.js";
import { THINKING_ROLES } from "../shared/thinking-colors.js";
import {
	detectMultiplexer,
	createSplit,
	createTab,
	sendKeys,
	getMultiplexerName,
} from "../shared/multiplexer.js";

import { normalize } from "@sting8k/pi-vcc/src/core/normalize";
import { filterNoise } from "@sting8k/pi-vcc/src/core/filter-noise";
import { buildSections } from "@sting8k/pi-vcc/src/core/build-sections";
import { redact } from "@sting8k/pi-vcc/src/core/redact";
import { TaskStore } from "@tintinweb/pi-tasks/src/task-store.js";

function shellQuote(value: string): string {
	if (value.length === 0) return "''";
	return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function getPiInvocationParts(): string[] {
	const currentScript = process.argv[1];
	if (currentScript && existsSync(currentScript)) {
		return [process.execPath, currentScript];
	}
	const execName = path.basename(process.execPath).toLowerCase();
	if (!/^(node|bun)(\.exe)?$/.test(execName)) {
		return [process.execPath];
	}
	return ["pi"];
}

interface HandoffModel {
	key: string;
	label: string;
	provider: string;
	model: string;
	thinking?: string;
}

const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;
type ThinkingLevel = (typeof THINKING_LEVELS)[number];

interface SelectedModel {
	provider: string;
	model: string;
	thinking: ThinkingLevel;
}

function loadFavouriteModels(): HandoffModel[] {
	const configPath = join(dirname(new URL(import.meta.url).pathname), "../leader-key/favourite-models.json");
	try {
		const raw = readFileSync(configPath, "utf-8");
		const parsed = JSON.parse(raw) as Array<Partial<HandoffModel>>;
		if (!Array.isArray(parsed)) return [];
		return parsed
			.filter(
				(e) => typeof e.label === "string" && typeof e.provider === "string" && typeof e.model === "string",
			)
			.map((e, index) => ({
				key: typeof e.key === "string" ? e.key : String(index + 1),
				label: e.label!,
				provider: e.provider!,
				model: e.model!,
				thinking: e.thinking,
			}));
	} catch {
		return [];
	}
}

async function pickModel(ctx: ExtensionContext): Promise<SelectedModel | null | undefined> {
	const favourites = loadFavouriteModels();
	if (favourites.length === 0) {
		ctx.ui.notify("No favourite models configured; using current/default model.", "info");
		return undefined;
	}

	interface PickerEntry {
		fav: HandoffModel;
		thinkingIndex: number;
	}

	const defaultThinkingIndex = THINKING_LEVELS.indexOf("medium");
	const entries: PickerEntry[] = favourites.map((fav) => {
		const favThinking = fav.thinking as ThinkingLevel | undefined;
		const idx = favThinking ? THINKING_LEVELS.indexOf(favThinking) : -1;
		return {
			fav,
			thinkingIndex: idx >= 0 ? idx : defaultThinkingIndex,
		};
	});

	return ctx.ui.custom<SelectedModel | null>(
		(tui, theme, _kb, done) => {
			let highlightedIndex = 0;
			const th = theme;

			return {
				render: (width: number) => {
					const f = new OverlayFrame(width, th);
					const lines: string[] = [];

					lines.push(f.top());
					lines.push(f.row(th.fg("accent", th.bold("Handoff Model"))));
					lines.push(f.separator());

					for (let i = 0; i < entries.length; i++) {
						const entry = entries[i];
						const isHighlighted = i === highlightedIndex;

						const keyTag = th.fg("dim", `[${entry.fav.key}]`);
						const label = isHighlighted
							? th.fg("accent", th.bold(entry.fav.label))
							: th.fg("text", entry.fav.label);
						const providerTag = th.fg("dim", `(${entry.fav.provider})`);

						const thinking = THINKING_LEVELS[entry.thinkingIndex];
						const thinkingRole = (THINKING_ROLES[thinking] ?? "dim") as Parameters<typeof th.fg>[0];
						const thinkingTag = isHighlighted
							? th.fg("dim", "\u2039") + th.fg(thinkingRole, ` ${thinking} `) + th.fg("dim", "\u203a")
							: th.fg(thinkingRole, thinking);

						const line = `${isHighlighted ? ">" : " "} ${keyTag} ${label} ${providerTag}  ${thinkingTag}`;
						lines.push(f.rowTruncated(line));
					}

					lines.push(f.separator());
					lines.push(f.row(th.fg("dim", "enter select | h/l thinking | j/k navigate | esc cancel")));
					lines.push(f.bottom());

					return lines;
				},
				invalidate: () => {},
				handleInput: (data: string) => {
					if (matchesKey(data, "escape") || matchesKey(data, Key.ctrl("c"))) {
						done(null);
						return;
					}

					if (matchesKey(data, "up") || matchesKey(data, Key.ctrl("p")) || data === "k") {
						highlightedIndex = Math.max(0, highlightedIndex - 1);
						tui.requestRender();
						return;
					}
					if (matchesKey(data, "down") || matchesKey(data, Key.ctrl("n")) || data === "j") {
						highlightedIndex = Math.min(entries.length - 1, highlightedIndex + 1);
						tui.requestRender();
						return;
					}

					if (matchesKey(data, "left") || data === "h") {
						const entry = entries[highlightedIndex];
						entry.thinkingIndex = (entry.thinkingIndex - 1 + THINKING_LEVELS.length) % THINKING_LEVELS.length;
						tui.requestRender();
						return;
					}
					if (matchesKey(data, "right") || data === "l") {
						const entry = entries[highlightedIndex];
						entry.thinkingIndex = (entry.thinkingIndex + 1) % THINKING_LEVELS.length;
						tui.requestRender();
						return;
					}

					// Quick-select by key
					const matchIndex = entries.findIndex((e) => e.fav.key === data);
					if (matchIndex >= 0) {
						const entry = entries[matchIndex];
						const thinking = THINKING_LEVELS[entry.thinkingIndex];
						done({ provider: entry.fav.provider, model: entry.fav.model, thinking });
						return;
					}

					if (matchesKey(data, "enter")) {
						const entry = entries[highlightedIndex];
						const thinking = THINKING_LEVELS[entry.thinkingIndex];
						done({ provider: entry.fav.provider, model: entry.fav.model, thinking });
						return;
					}
				},
			};
		},
		{ overlay: true },
	);
}

function buildPiCommand(prompt: string, model?: SelectedModel): string {
	const parts = [...getPiInvocationParts()];
	if (model) {
		parts.push("--model", `${model.provider}/${model.model}`, "--thinking", model.thinking);
	}
	if (prompt.length > 0) {
		parts.push(prompt);
	}
	return parts.map(shellQuote).join(" ");
}

/**
 * Build a pi command that reads the prompt from a file via shell command
 * substitution. The multiplexer only has to transmit the short
 * `pi "$(cat '<file>')"` command; the full prompt text travels from disk
 * straight into pi's argv without being typed/pasted through the mux.
 */
function buildPiCommandFromFile(promptFile: string, prompt: string, model?: SelectedModel): string {
	const parts = [...getPiInvocationParts()];
	if (model) {
		parts.push("--model", `${model.provider}/${model.model}`, "--thinking", model.thinking);
	}
	const quotedParts = parts.map(shellQuote);
	if (prompt.length > 0) {
		// Path is single-quoted inside the substitution so spaces/special chars are safe.
		quotedParts.push(`"$(cat ${shellQuote(promptFile)})"`);
	}
	return quotedParts.join(" ");
}

function writeTempPromptFile(prompt: string): string | null {
	try {
		const filePath = join(
			tmpdir(),
			`pi-handoff-prompt-${Date.now()}-${Math.random().toString(36).slice(2)}.md`,
		);
		writeFileSync(filePath, prompt, "utf-8");
		return filePath;
	} catch {
		return null;
	}
}

const DEFAULT_HANDOFF_GOAL = "Continue from the previous session and pick up the next sensible step.";

function normalizeGoal(goal: string | undefined): string {
	const trimmed = goal?.trim();
	return trimmed && trimmed.length > 0 ? trimmed : DEFAULT_HANDOFF_GOAL;
}

function parseArgs(raw: string): { useTab: boolean; goal: string } {
	const trimmed = raw.trim();
	if (trimmed.startsWith("--tab ")) {
		return { useTab: true, goal: trimmed.slice(6).trim() };
	}
	if (trimmed === "--tab") {
		return { useTab: true, goal: "" };
	}
	return { useTab: false, goal: trimmed };
}

/**
 * Build a context summary using pi-vcc's building blocks but WITHOUT the
 * 120-line capBrief truncation. Standard vccCompile loses the first half of
 * longer conversations — this version keeps the full brief transcript.
 *
 * Typical sizes:
 *   - capped vcc:  ~4K tokens  (loses early decisions)
 *   - uncapped:    ~9K tokens  (keeps all user+assistant messages)
 *   - full serial: ~80K tokens (includes tool results)
 */
function buildContextSummary(ctx: ExtensionContext): string | null {
	const branch = ctx.sessionManager.getBranch();
	const messages = branch
		.filter((entry): entry is SessionEntry & { type: "message" } => entry.type === "message")
		.map((entry) => entry.message);

	if (messages.length === 0) return null;

	const llmMessages = convertToLlm(messages);
	const blocks = filterNoise(normalize(llmMessages));
	const data = buildSections({ blocks });

	const section = (title: string, items: string[]): string => {
		if (items.length === 0) return "";
		return `[${title}]\n${items.map((i) => `- ${i}`).join("\n")}`;
	};

	const headerParts = [
		section("Session Goal", data.sessionGoal),
		section("Files And Changes", data.filesAndChanges),
		section("Outstanding Context", data.outstandingContext),
		section("User Preferences", data.userPreferences),
	].filter(Boolean);

	const parts: string[] = [];
	if (headerParts.length > 0) parts.push(headerParts.join("\n\n"));
	if (data.briefTranscript) parts.push(data.briefTranscript); // NO capBrief!

	if (parts.length === 0) return null;

	parts.push(
		"Do not redo work already completed. Use `session_query` on the parent session if you need more details.",
	);

	return redact(parts.join("\n\n---\n\n"));
}

// ── Language detection word lists ──
// High-frequency words per language that appear even without diacritics.
const LANG_WORDS: Record<string, Set<string>> = {
	Czech: new Set([
		"je", "se", "na", "to", "ze", "jak", "ale", "nebo", "tak", "jsem",
		"bych", "neni", "jeste", "taky", "proste", "treba", "tohle", "potom",
		"kdyz", "jako", "protoze", "docela", "vlastne", "udelat", "podivat",
		"pojdme", "muzeme", "nejakej", "zkusit", "myslim", "mohli", "dobry",
		"chci", "neco", "delat", "bude", "jsou", "bylo", "jsme", "mame",
		"potreba", "funguje", "nemyslim", "udelej", "podivej", "prosim",
	]),
	German: new Set([
		"ich", "ist", "das", "nicht", "ein", "und", "der", "die", "wir",
		"auch", "aber", "noch", "dann", "wenn", "oder", "kann", "schon",
		"jetzt", "hier", "haben", "wird", "gibt", "muss", "ganz", "sehr",
	]),
	French: new Set([
		"est", "les", "des", "une", "que", "pas", "pour", "dans", "avec",
		"sur", "mais", "plus", "tout", "aussi", "bien", "peut", "faire",
		"comme", "cette", "sont", "nous", "vous", "tres", "donc", "voila",
	]),
	Spanish: new Set([
		"que", "los", "las", "una", "con", "por", "para", "pero", "como",
		"mas", "muy", "todo", "esta", "puede", "hacer", "tiene", "desde",
		"tambien", "cuando", "donde", "ahora", "hay", "algo", "mejor", "creo",
	]),
	Polish: new Set([
		"nie", "jest", "sie", "jak", "ale", "czy", "tak", "jeszcze", "jest",
		"moze", "tylko", "trzeba", "tutaj", "dobrze", "teraz", "jesli",
		"bardzo", "kiedy", "albo", "troche", "mozna", "gdzie", "wszystko",
	]),
};

/**
 * Detect the dominant non-English language from user messages.
 * Uses both Unicode range detection (for diacritics) and word-frequency
 * matching (for ASCII-only variants like Czech without háčky).
 */
function detectLanguage(ctx: ExtensionContext): { language: string; sample: string } | null {
	const branch = ctx.sessionManager.getBranch();
	const userMessages = branch
		.filter((entry): entry is SessionEntry & { type: "message" } => entry.type === "message")
		.map((entry) => entry.message)
		.filter((m) => m.role === "user");

	if (userMessages.length === 0) return null;

	const recentTexts = userMessages
		.slice(-5)
		.flatMap((m) =>
			typeof m.content === "string"
				? [m.content]
				: m.content.map((content) => content.type === "text" ? content.text : ""),
		)
		.join(" ");

	if (!recentTexts.trim()) return null;

	// 1. Unicode diacritics check (catches properly-typed non-English)
	const hasNonAscii = /[\u00C0-\u024F\u0400-\u04FF\u4E00-\u9FFF\u3040-\u309F\u30A0-\u30FF]/.test(recentTexts);

	// 2. Word-frequency check (catches ASCII-only non-English like Czech without háčky)
	const words = recentTexts.toLowerCase().split(/\s+/);
	const scores: Record<string, number> = {};
	for (const [lang, wordSet] of Object.entries(LANG_WORDS)) {
		let hits = 0;
		for (const w of words) {
			if (wordSet.has(w)) hits++;
		}
		scores[lang] = hits;
	}
	const bestLang = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
	const hasWordMatch = bestLang && bestLang[1] >= 3;

	if (!hasNonAscii && !hasWordMatch) return null;

	const language = hasWordMatch ? bestLang![0] : "non-English";
	return { language, sample: recentTexts.slice(0, 300) };
}

// ── Git state ──

/**
 * Collect git state: branch, staged files, modified files.
 * Returns null if not in a git repo. Total exec time: ~26ms.
 */
function buildGitState(): string | null {
	try {
		const branch = execFileSync("git", ["branch", "--show-current"], { encoding: "utf8", timeout: 2000 }).trim();
		const status = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8", timeout: 2000 }).trim();

		if (!branch && !status) return null;

		const lines: string[] = [];
		if (branch) lines.push(`Branch: ${branch}`);

		if (status) {
			const staged: string[] = [];
			const modified: string[] = [];
			const untracked: string[] = [];
			for (const line of status.split("\n")) {
				const idx = line[0];
				const wt = line[1];
				const file = line.slice(3);
				if (idx === "?" && wt === "?") { untracked.push(file); continue; }
				if (idx && idx !== " " && idx !== "?") staged.push(file);
				if (wt && wt !== " " && wt !== "?") modified.push(file);
			}
			if (staged.length > 0) lines.push(`Staged: ${staged.slice(0, 10).join(", ")}${staged.length > 10 ? ` (+${staged.length - 10} more)` : ""}`);
			if (modified.length > 0) lines.push(`Modified (unstaged): ${modified.slice(0, 10).join(", ")}${modified.length > 10 ? ` (+${modified.length - 10} more)` : ""}`);
			if (untracked.length > 0) lines.push(`Untracked: ${untracked.length} file(s)`);
		} else {
			lines.push("Working tree clean");
		}

		return lines.join("\n");
	} catch {
		return null;
	}
}

// ── Working set extraction ──

const FILE_PATH_TOOLS = new Set(["read", "edit", "write", "Read", "Edit", "Write"]);

/**
 * Extract the most recently touched files from the last N assistant messages.
 * Returns a deduplicated list with the most recent files first.
 */
function extractWorkingFiles(ctx: ExtensionContext, maxFiles = 5): string[] {
	const branch = ctx.sessionManager.getBranch();
	const assistantMessages = branch
		.filter((entry): entry is SessionEntry & { type: "message" } => entry.type === "message")
		.map((entry) => entry.message)
		.filter((m) => m.role === "assistant");

	// Scan from the end to get the most recent files
	const seen = new Set<string>();
	const result: string[] = [];

	for (let i = assistantMessages.length - 1; i >= 0 && result.length < maxFiles; i--) {
		const msg = assistantMessages[i];
		for (const block of msg.content) {
			if (block.type !== "toolCall") continue;
			if (!FILE_PATH_TOOLS.has(block.name)) continue;
			const args = block.arguments as Record<string, unknown>;
			const filePath = (args.path ?? args.file_path ?? args.file) as string | undefined;
			if (!filePath || seen.has(filePath)) continue;
			seen.add(filePath);
			result.push(filePath);
			if (result.length >= maxFiles) break;
		}
	}

	return result;
}

/**
 * Resolve the task store file path for the current session.
 * Mirrors pi-tasks logic: env PI_TASKS > tasks-config.json > default session scope.
 */
function resolveTaskStorePath(sessionId: string): string | undefined {
	const piTasks = process.env.PI_TASKS;
	if (piTasks === "off") return undefined;
	if (piTasks?.startsWith("/")) return piTasks;
	if (piTasks?.startsWith(".")) return resolve(piTasks);
	if (piTasks) return piTasks;

	// Read tasks-config.json for scope
	let taskScope = "session";
	try {
		const cfg = JSON.parse(readFileSync(join(process.cwd(), ".pi", "tasks-config.json"), "utf-8"));
		if (cfg.taskScope) taskScope = cfg.taskScope;
	} catch { /* no config — default session scope */ }

	if (taskScope === "memory") return undefined;
	if (taskScope === "session") return join(process.cwd(), ".pi", "tasks", `tasks-${sessionId}.json`);
	return join(process.cwd(), ".pi", "tasks", "tasks.json");
}

interface HandoffTask {
	id: string;
	subject: string;
	status: string;
	description: string;
	blockedBy: string[];
}

/**
 * Read current tasks from pi-tasks store.
 */
function readTasks(sessionId: string): HandoffTask[] | null {

	const storePath = resolveTaskStorePath(sessionId);
	if (!storePath || !existsSync(storePath)) return null;

	try {
		const store = new TaskStore(storePath);
		const tasks = store.list();
		if (tasks.length === 0) return null;
		return tasks;
	} catch {
		return null;
	}
}

/**
 * Format tasks into a section with instructions for the new session.
 * Incomplete tasks get a TaskCreate instruction; completed ones are listed for reference.
 * Uses subject-based references for blockedBy (IDs won't survive handoff).
 */
function formatTasksSection(tasks: HandoffTask[]): string {
	const incomplete = tasks.filter((t) => t.status !== "completed");
	const completed = tasks.filter((t) => t.status === "completed");

	// Build ID → subject map for dependency resolution
	const idToSubject = new Map<string, string>();
	for (const t of tasks) idToSubject.set(t.id, t.subject);

	const lines: string[] = [];

	if (incomplete.length > 0) {
		lines.push(
			"**IMPORTANT: Before doing anything else, recreate the following tasks using TaskCreate"
			+ " (one call per task). Preserve the original subject, description, and dependency structure."
			+ " Tasks that were in_progress should be created as pending."
			+ " Use addBlockedBy with the NEW task IDs after creating all tasks.**\n",
		);
		for (const t of incomplete) {
			lines.push(`- [${t.status}] ${t.subject}`);
			if (t.description) lines.push(`  Description: ${t.description}`);
			if (t.blockedBy.length > 0) {
				const deps = t.blockedBy.map((b) => {
					const subj = idToSubject.get(b);
					return subj ? `"${subj}"` : `#${b}`;
				});
				lines.push(`  Blocked by: ${deps.join(", ")}`);
			}
		}
	}

	if (completed.length > 0) {
		lines.push("\nAlready completed (for reference only, do NOT recreate):");
		for (const t of completed) {
			lines.push(`- ✅ ${t.subject}`);
		}
	}

	return lines.join("\n");
}

/**
 * Replace the vcc_recall note with a handoff-appropriate version.
 * The original references vcc_recall which doesn't exist in the new session.
 */
function replaceRecallNote(summary: string): string {
	return summary.replace(
		/Use `vcc_recall` to search for prior work[^]*?Do not redo work already completed\./g,
		"Do not redo work already completed. Use `session_query` on the parent session if you need more details.",
	).trim();
}

interface HandoffContext {
	goal: string | undefined;
	summary: string;
	tasks: HandoffTask[] | null;
	sessionFile: string | undefined;
	gitState: string | null;
	workingFiles: string[];
	artifactPath: string | null;
}

/**
 * Build the final handoff prompt.
 */
function buildHandoffPrompt(hctx: HandoffContext): string {
	const parts: string[] = [];
	const effectiveGoal = normalizeGoal(hctx.goal);

	parts.push(effectiveGoal);

	// ── Parent session ──
	if (hctx.sessionFile) {
		parts.push(
			`\n**Parent session:** \`${hctx.sessionFile}\`\n`
			+ "Use `session_query` on the parent session if you need more details beyond the summary below.",
		);
	}

	// ── Handoff artifact ──
	if (hctx.artifactPath) {
		parts.push(`**Handoff artifact:** \`${hctx.artifactPath}\` (re-read if you need the full context again)`);
	}

	// ── Instructions for context continuity ──
	parts.push(
		"\n## Instructions"
		+ "\n\n**FIRST STEP: Before doing ANY work, carefully read the context summary below."
		+ " Identify the key decisions, agreements, and chosen approach from the previous session."
		+ " State them back briefly, then proceed with the goal."
		+ " Honor previous decisions unless the user explicitly changes direction."
		+ " Pay special attention to [user] entries in the transcript — that's where decisions are.**",
	);

	// ── Git state ──
	if (hctx.gitState) {
		parts.push(`\n## Git State\n\n${hctx.gitState}`);
	}

	// ── Working files ──
	if (hctx.workingFiles.length > 0) {
		parts.push(
			`\n## Current Working Files (most recently touched)\n\n`
			+ hctx.workingFiles.map((f) => `- ${f}`).join("\n"),
		);
	}

	// ── Tasks ──
	if (hctx.tasks && hctx.tasks.length > 0) {
		parts.push(`\n## Tasks from previous session\n\n${formatTasksSection(hctx.tasks)}`);
	}

	// ── Context summary (vcc) ──
	parts.push(`\n## Context from previous session\n\n${replaceRecallNote(hctx.summary)}`);

	return parts.join("\n");
}

/**
 * Save handoff prompt as an artifact for resilience and debuggability.
 * Returns the artifact file path, or null on failure.
 */
function saveHandoffArtifact(prompt: string, sessionId: string): string | null {
	try {
		const dir = join(process.cwd(), ".pi", "handoffs");
		mkdirSync(dir, { recursive: true });
		const ts = new Date().toISOString().replace(/[:.]/g, "-");
		const shortId = sessionId.slice(0, 8);
		const filePath = join(dir, `${ts}_${shortId}.md`);
		writeFileSync(filePath, prompt, "utf-8");
		return filePath;
	} catch {
		return null;
	}
}

/**
 * Core handoff: generate summary, open split/tab, launch pi with prompt.
 * All operations are algorithmic (no LLM calls) for speed.
 */
async function performHandoff(
	ctx: ExtensionContext,
	goal?: string,
	model?: SelectedModel,
	useTab = false,
): Promise<string | undefined> {
	if (!ctx.hasUI) return "Handoff requires interactive mode.";

	const mux = detectMultiplexer();
	if (!mux) return "No supported multiplexer detected (herder, tmux, or cmux).";

	// Start split/tab immediately (runs in parallel with prompt building)
	const targetPromise = new Promise<ReturnType<typeof createSplit> | string>((resolve) => {
		try {
			const target = useTab ? createTab("handoff") : createSplit("right");
			if (!target) {
				resolve(`Failed to create ${useTab ? "tab" : "split"} in ${mux}.`);
				return;
			}
			resolve(target);
		} catch (err) {
			resolve(`${mux} error: ${err}`);
		}
	});

	// Build prompt concurrently with split/tab creation
	const summary = buildContextSummary(ctx);
	if (!summary) return "No conversation to hand off.";

	const sessionFile = ctx.sessionManager.getSessionFile();
	const sessionId = ctx.sessionManager.getSessionId();

	const hctx: HandoffContext = {
		goal,
		summary,
		tasks: readTasks(sessionId),
		sessionFile,

		gitState: buildGitState(),
		workingFiles: extractWorkingFiles(ctx),
		artifactPath: null, // set after saving
	};

	// Save artifact
	const prompt = buildHandoffPrompt(hctx);
	const artifactPath = saveHandoffArtifact(prompt, sessionId);
	if (artifactPath) {
		hctx.artifactPath = artifactPath;
	}
	// Rebuild with artifact path included
	const finalPrompt = artifactPath ? buildHandoffPrompt(hctx) : prompt;

	// Wait for split/tab to be ready
	const targetOrError = await targetPromise;
	if (typeof targetOrError === "string") {
		return targetOrError;
	}
	const target = targetOrError;

	// Wait for shell to initialize
	await new Promise((r) => setTimeout(r, 500));

	// Launch pi with the handoff prompt.
	// Write the prompt to a temp file and pass it via `$(cat <file>)` so the
	// multiplexer only transmits a short command, not the whole prompt text.
	const promptFile = writeTempPromptFile(finalPrompt);
	if (!promptFile) return "Failed to save handoff prompt to disk.";

	const command = buildPiCommandFromFile(promptFile, finalPrompt, model);
	sendKeys(target, command);

	// Safe to delete once the shell has expanded the command substitution.
	setTimeout(() => {
		try { unlinkSync(promptFile); } catch {}
	}, 30000);

	return undefined;
}

export default function (pi: ExtensionAPI) {
	// /handoff command
	pi.registerCommand("handoff", {
		description: "Transfer context to a new pi session in a split or tab (tmux/cmux). Usage: /handoff [--tab] [optional goal]",
		handler: async (args, ctx) => {
			const { useTab, goal } = parseArgs(args);
			const model = await pickModel(ctx);
			if (model === null) return; // cancelled
			const error = await performHandoff(ctx, goal, model, useTab);
			if (error) {
				ctx.ui.notify(error, "error");
			} else {
				ctx.ui.notify(`Handoff sent to new ${getMultiplexerName()} ${useTab ? "tab" : "split"}.`, "info");
			}
		},
	});

	// handoff tool (agent-callable)
	pi.registerTool({
		name: "handoff",
		label: "Handoff",
		description:
			"Transfer context to a new pi session in a separate split or tab. ONLY use when the user explicitly asks for a handoff. Goal is optional; if omitted, the new session continues from the previous one.",
		parameters: Type.Object({
			goal: Type.Optional(Type.String({ description: "Optional goal/task for the new session" })),
			tab: Type.Optional(Type.Boolean({ description: "Open in a new tab/window instead of a split" })),
		}),

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const effectiveGoal = normalizeGoal(params.goal);
			const useTab = params.tab === true;
			const error = await performHandoff(ctx, params.goal, undefined, useTab);
			if (error) {
				return {
					content: [{ type: "text" as const, text: `Handoff failed: ${error}` }],
					details: { error: true },
				};
			}
			return {
				content: [{ type: "text" as const, text: `Handoff started in a new ${getMultiplexerName()} ${useTab ? "tab" : "split"} with goal: ${effectiveGoal}` }],
				details: { goal: effectiveGoal, tab: useTab },
			};
		},
	});
}
