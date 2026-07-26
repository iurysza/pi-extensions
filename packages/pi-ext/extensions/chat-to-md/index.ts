import type {
	ExtensionAPI,
	ExtensionContext,
	SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { mkdir, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

const CHAT_DIRECTORY = join("ai-artifacts", "chat");
const MAX_SLUG_LENGTH = 64;

export function extractLastAssistantText(entries: SessionEntry[]): string | undefined {
	for (let index = entries.length - 1; index >= 0; index--) {
		const entry = entries[index];
		if (entry.type !== "message" || entry.message.role !== "assistant") continue;

		const text = entry.message.content
			.filter((block) => block.type === "text")
			.map((block) => block.text)
			.join("\n\n")
			.trim();

		if (text) return text;
	}

	return undefined;
}

export function slugifyResponse(text: string): string {
	const firstMeaningfulLine = text
		.split(/\r?\n/)
		.map((line) => line.trim())
		.find((line) => line.length > 0 && !/^(?:```|~~~)/.test(line));

	if (!firstMeaningfulLine) return "response";

	const cleaned = firstMeaningfulLine
		.replace(/^#{1,6}\s+/, "")
		.replace(/^(?:[-*+]|\d+[.)])\s+/, "")
		.replace(/^>\s*/, "")
		.replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
		.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
		.replace(/[`*_~]/g, "")
		.split(/\s+/)
		.slice(0, 8)
		.join(" ")
		.normalize("NFKD")
		.replace(/\p{Mark}+/gu, "")
		.toLowerCase()
		.replace(/[’']/g, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, MAX_SLUG_LENGTH)
		.replace(/-+$/g, "");

	return cleaned || "response";
}

export function formatLocalDate(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

async function repositoryRoot(pi: ExtensionAPI, cwd: string): Promise<string> {
	const result = await pi.exec("git", ["rev-parse", "--show-toplevel"], {
		cwd,
		timeout: 5_000,
	});
	const root = result.stdout.trim();
	if (result.code !== 0 || !root) throw new Error("Not inside a Git repository");
	return resolve(root);
}

async function writeUniqueMarkdown(directory: string, title: string, content: string): Promise<string> {
	for (let copy = 1; ; copy++) {
		const suffix = copy === 1 ? "" : `-${copy}`;
		const filePath = join(directory, `${title}${suffix}.md`);
		try {
			await writeFile(filePath, content, { encoding: "utf8", flag: "wx" });
			return filePath;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
		}
	}
}

export async function saveLastResponse(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	now = new Date(),
): Promise<string | undefined> {
	if (!ctx.isIdle()) {
		ctx.ui.notify("Wait for the current response to finish", "warning");
		return undefined;
	}

	const response = extractLastAssistantText(ctx.sessionManager.getBranch());
	if (!response) {
		ctx.ui.notify("No assistant response with text found", "warning");
		return undefined;
	}

	try {
		const root = await repositoryRoot(pi, ctx.cwd);
		const directory = join(root, CHAT_DIRECTORY);
		const title = `${formatLocalDate(now)}-${slugifyResponse(response)}`;
		await mkdir(directory, { recursive: true });
		const filePath = await writeUniqueMarkdown(directory, title, `${response}\n`);
		ctx.ui.notify(`Saved ${relative(root, filePath)}`, "info");
		return filePath;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		ctx.ui.notify(`chat-to-md: ${message}`, "error");
		return undefined;
	}
}

export default function chatToMarkdown(pi: ExtensionAPI) {
	pi.registerCommand("chat-to-md", {
		description: "Save the last assistant response to ai-artifacts/chat",
		handler: async (_args, ctx) => {
			await ctx.waitForIdle();
			await saveLastResponse(pi, ctx);
		},
	});
}
