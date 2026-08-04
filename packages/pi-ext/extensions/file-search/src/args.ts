import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import {
	FD_DEFAULT_LIMIT,
	FD_MAX_DEPTH,
	FD_MAX_LIMIT,
	RG_DEFAULT_LIMIT,
	RG_MAX_CONTEXT,
	RG_MAX_LIMIT,
	boundedInteger,
} from "./limits.ts";

export type FdEntryType = "file" | "directory" | "symlink" | "executable" | "empty" | "socket" | "pipe";
export interface FdParams {
	pattern?: string;
	path?: string;
	type?: FdEntryType;
	extension?: string;
	glob?: boolean;
	hidden?: boolean;
	maxDepth?: number;
	limit?: number;
}

export type RgCase = "smart" | "insensitive" | "sensitive";
export interface RgParams {
	pattern: string;
	path?: string;
	glob?: string;
	type?: string;
	case?: RgCase;
	literal?: boolean;
	hidden?: boolean;
	context?: number;
	maxCount?: number;
}

export function normalizePath(input: string | undefined, cwd: string, home = homedir()): string {
	let value = (input ?? ".").trim();
	while (value.startsWith("@")) value = value.slice(1);
	if (value === "") value = ".";
	if (value === "~") value = home;
	else if (value.startsWith("~/")) value = resolve(home, value.slice(2));
	return isAbsolute(value) ? resolve(value) : resolve(cwd, value);
}

export function normalizeExtension(extension: string): string {
	return extension.replace(/^\.+/, "");
}

const fdTypes: Record<FdEntryType, string> = {
	file: "f",
	directory: "d",
	symlink: "l",
	executable: "x",
	empty: "e",
	socket: "s",
	pipe: "p",
};

export function buildFdArgs(params: FdParams, cwd: string, home = homedir()): string[] {
	const args = ["--color", "never", "--max-results", String(boundedInteger(params.limit, FD_DEFAULT_LIMIT, 1, FD_MAX_LIMIT))];
	if (params.type) args.push("--type", fdTypes[params.type]);
	if (params.extension) {
		const extension = normalizeExtension(params.extension);
		if (extension) args.push("--extension", extension);
	}
	if (params.glob) args.push("--glob");
	if (params.hidden) args.push("--hidden");
	if (params.maxDepth !== undefined) args.push("--max-depth", String(boundedInteger(params.maxDepth, FD_MAX_DEPTH, 0, FD_MAX_DEPTH)));
	args.push("--", params.pattern ?? ".", normalizePath(params.path, cwd, home));
	return args;
}

export function buildRgArgs(params: RgParams, cwd: string, home = homedir()): string[] {
	const args = [
		"--color", "never",
		"--line-number",
		"--with-filename",
		"--max-count", String(boundedInteger(params.maxCount, RG_DEFAULT_LIMIT, 1, RG_MAX_LIMIT)),
	];
	const caseMode = params.case ?? "smart";
	args.push(caseMode === "insensitive" ? "--ignore-case" : caseMode === "sensitive" ? "--case-sensitive" : "--smart-case");
	if (params.glob) args.push("--glob", params.glob);
	if (params.type) args.push("--type", params.type);
	if (params.literal) args.push("--fixed-strings");
	if (params.hidden) args.push("--hidden");
	if (params.context !== undefined) args.push("--context", String(boundedInteger(params.context, 0, 0, RG_MAX_CONTEXT)));
	args.push("--", params.pattern, normalizePath(params.path, cwd, home));
	return args;
}
