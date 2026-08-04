import { buildFdArgs, buildRgArgs, type FdParams, type RgParams } from "./args.ts";
import type { ResolvedBinary, ToolName } from "./binaries.ts";
import { runSearch, type SearchProcessResult } from "./process.ts";

export async function searchWithBinary(
	tool: ToolName,
	binary: ResolvedBinary,
	params: FdParams | RgParams,
	cwd: string,
	signal?: AbortSignal,
	timeoutMs?: number,
): Promise<SearchProcessResult> {
	const args = tool === "fd" ? buildFdArgs(params as FdParams, cwd) : buildRgArgs(params as RgParams, cwd);
	return runSearch({ tool, command: binary.path, args, cwd, signal, timeoutMs });
}
