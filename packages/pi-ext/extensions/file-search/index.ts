import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { BinaryResolvers, type ResolvedBinary, type ToolName } from "./src/binaries.ts";
import { type FdParams, type RgParams } from "./src/args.ts";
import { FD_DESCRIPTION, FD_GUIDELINES, FD_SNIPPET, RG_DESCRIPTION, RG_GUIDELINES, RG_SNIPPET } from "./src/prompt.ts";
import { searchWithBinary } from "./src/search.ts";

interface SearchDetails {
	tool: ToolName;
	kind: "progress" | "matches" | "no-matches";
	totalBytes?: number;
	totalLines?: number;
	truncated?: boolean;
	outputPath?: string;
	binarySource?: string;
}

function compactCall(tool: ToolName, args: Record<string, unknown>, theme: any): Text {
	const pattern = typeof args.pattern === "string" ? args.pattern : "*";
	const path = typeof args.path === "string" ? args.path : ".";
	return new Text(`${theme.fg("toolTitle", theme.bold(`${tool} `))}${theme.fg("accent", pattern)} ${theme.fg("muted", path)}`, 0, 0);
}

function compactResult(result: any, options: any, theme: any): Text {
	const details = result.details as SearchDetails | undefined;
	const content = result.content?.[0];
	if (options?.expanded && content?.type === "text") return new Text(theme.fg(result.isError ? "error" : "toolOutput", content.text), 0, 0);
	if (!details) {
		return new Text(theme.fg(result.isError ? "error" : "toolOutput", content?.type === "text" ? content.text : ""), 0, 0);
	}
	if (details.kind === "progress") return new Text(theme.fg("muted", `${details.tool} searching…`), 0, 0);
	if (details.kind === "no-matches") return new Text(theme.fg("muted", `${details.tool}: no matches`), 0, 0);
	const count = `${details.totalLines ?? 0} lines, ${details.totalBytes ?? 0} bytes`;
	const suffix = details.truncated ? ` · truncated · ${details.outputPath}` : "";
	return new Text(theme.fg(details.truncated ? "warning" : "success", `${details.tool}: ${count}${suffix}`), 0, 0);
}

export default function fileSearch(pi: ExtensionAPI, resolvers = new BinaryResolvers()): void {

	async function execute(tool: ToolName, params: FdParams | RgParams, signal: AbortSignal, onUpdate: any, cwd: string) {
		onUpdate?.({ content: [{ type: "text" as const, text: `${tool} searching…` }], details: { tool, kind: "progress" } satisfies SearchDetails });
		let binary: ResolvedBinary;
		try {
			binary = await resolvers.resolve(tool);
		} catch (error) {
			throw new Error(`${tool} setup failed: ${error instanceof Error ? error.message : String(error)}`);
		}
		let result;
		try {
			result = await searchWithBinary(tool, binary, params, cwd, signal);
		} catch (error) {
			throw new Error(`${tool} execution failed: ${error instanceof Error ? error.message : String(error)}`);
		}
		return {
			content: [{ type: "text" as const, text: result.text }],
			details: {
				tool,
				kind: result.kind,
				totalBytes: result.totalBytes,
				totalLines: result.totalLines,
				truncated: result.truncated,
				outputPath: result.outputPath,
				binarySource: binary.source,
			} satisfies SearchDetails,
		};
	}

	pi.registerTool({
		name: "fd",
		label: "fd",
		description: FD_DESCRIPTION,
		promptSnippet: FD_SNIPPET,
		promptGuidelines: FD_GUIDELINES,
		parameters: Type.Object({
			pattern: Type.Optional(Type.String({ description: "Name regex or glob. Omit to list all entries." })),
			path: Type.Optional(Type.String({ description: "Directory to search. Defaults to Pi's current directory." })),
			type: Type.Optional(StringEnum(["file", "directory", "symlink", "executable", "empty", "socket", "pipe"] as const)),
			extension: Type.Optional(Type.String({ description: "File extension, with or without a leading dot." })),
			glob: Type.Optional(Type.Boolean({ description: "Interpret pattern as a glob instead of a regex." })),
			hidden: Type.Optional(Type.Boolean({ description: "Include hidden entries while still respecting ignore files." })),
			maxDepth: Type.Optional(Type.Integer({ minimum: 0, maximum: 64 })),
			limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 10_000 })),
		}, { additionalProperties: false }),
		async execute(_id, params, signal, onUpdate, ctx) { return execute("fd", params, signal, onUpdate, ctx.cwd); },
		renderCall(args, theme) { return compactCall("fd", args, theme); },
		renderResult(result, options, theme) { return compactResult(result, options, theme); },
	});

	pi.registerTool({
		name: "rg",
		label: "rg",
		description: RG_DESCRIPTION,
		promptSnippet: RG_SNIPPET,
		promptGuidelines: RG_GUIDELINES,
		parameters: Type.Object({
			pattern: Type.String({ description: "Regex content pattern. Use literal=true for literal metacharacters." }),
			path: Type.Optional(Type.String({ description: "File or directory to search. Defaults to Pi's current directory." })),
			glob: Type.Optional(Type.String({ description: "Include or exclude file glob, for example '*.ts' or '!vendor/**'." })),
			type: Type.Optional(Type.String({ description: "Ripgrep file type, for example ts or markdown." })),
			case: Type.Optional(StringEnum(["smart", "insensitive", "sensitive"] as const)),
			literal: Type.Optional(Type.Boolean({ description: "Match the pattern literally, not as a regular expression." })),
			hidden: Type.Optional(Type.Boolean({ description: "Include hidden files while still respecting ignore files." })),
			context: Type.Optional(Type.Integer({ minimum: 0, maximum: 20 })),
			maxCount: Type.Optional(Type.Integer({ minimum: 1, maximum: 1_000 })),
		}, { additionalProperties: false }),
		async execute(_id, params, signal, onUpdate, ctx) { return execute("rg", params, signal, onUpdate, ctx.cwd); },
		renderCall(args, theme) { return compactCall("rg", args, theme); },
		renderResult(result, options, theme) { return compactResult(result, options, theme); },
	});

	pi.on("session_start", async (_event, ctx) => {
		for (const tool of ["fd", "rg"] as const) {
			void resolvers.resolve(tool).then((binary) => {
				if (binary.source === "installed") ctx.ui.notify(`${tool} ${binary.version} installed at ${binary.path}`, "info");
			}).catch((error) => ctx.ui.notify(`${tool} setup failed: ${error instanceof Error ? error.message : String(error)}`, "warning"));
		}
	});
}
