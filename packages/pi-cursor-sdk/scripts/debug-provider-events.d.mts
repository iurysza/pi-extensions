export interface CursorDebugProviderEventsArgs {
	cwd: string;
	model: string;
	prompt?: string;
	promptFile?: string;
	out?: string;
	settingSources?: string[] | undefined;
	sessionDir?: string;
	apiKey?: string;
	help: boolean;
}

export declare function parseDebugProviderEventsArgs(
	argv: string[],
	env?: NodeJS.ProcessEnv,
): CursorDebugProviderEventsArgs;

export interface CursorPiSessionSnapshotState {
	copied: boolean;
	sessionFile?: string;
	reason?: string;
	recoveredAfterChildExit?: boolean;
}

export type CursorDebugCaptureCounts = Record<string, number | Record<string, number>>;

export interface CursorDebugCaptureSummary {
	artifactDir: string;
	sessionFile?: string;
	counts: CursorDebugCaptureCounts;
	piSessionSnapshot?: CursorPiSessionSnapshotState;
	artifacts?: Record<string, string>;
	elapsedMs?: number;
	waitResultRecorded?: boolean;
}

export interface CursorDebugProviderEventsRunSummary {
	artifactDir: string;
	artifacts: Record<string, string>;
	counts: CursorDebugCaptureCounts;
	elapsedMs: number;
	model: string;
	cwd: string;
	sessionDir: string;
	extensionVersion: string;
	sdkVersion: string;
	waitResultRecorded: boolean;
}

export declare function backfillPiSessionSnapshot(
	captureSummary: CursorDebugCaptureSummary | undefined,
	artifactDir: string,
	sessionDir: string,
): CursorDebugCaptureSummary | undefined;

export declare function runDebugProviderEvents(
	args: CursorDebugProviderEventsArgs,
	env?: NodeJS.ProcessEnv,
): Promise<CursorDebugProviderEventsRunSummary>;
