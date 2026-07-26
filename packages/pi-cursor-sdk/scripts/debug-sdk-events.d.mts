export interface CursorDebugSdkEventsArgs {
	cwd: string;
	model: string;
	prompt?: string;
	out?: string;
	settingSources?: string[] | undefined;
	includeConversation: boolean;
	apiKey?: string;
	help: boolean;
}

export interface CursorSdkEventDebugSummary {
	artifactDir: string;
	files: {
		metadata: string;
		streamEvents: string;
		onDelta: string;
		onStep: string;
		waitResult: string;
		conversation?: string;
	};
	counts: {
		stream: Record<string, number>;
		onDelta: Record<string, number>;
		onStep: Record<string, number>;
	};
	timing: {
		stream: CursorSdkEventTimingSnapshot;
		onDelta: CursorSdkEventTimingSnapshot;
		onStep: CursorSdkEventTimingSnapshot;
	};
	wait?: {
		status: string;
		durationMs: number;
		hasResultText: boolean;
	};
	conversation?: { turnCount: number } | Record<string, unknown>;
	warnings: string[];
}

export interface CursorSdkEventTimingSnapshot {
	eventCount: number;
	firstMs?: number;
	lastMs?: number;
	maxGapMs?: number;
}

export declare function parseDebugSdkEventsArgs(
	argv: string[],
	env?: NodeJS.ProcessEnv,
): CursorDebugSdkEventsArgs;

export declare function createTimingTracker(): {
	eventCount: number;
	firstMs?: number;
	lastMs?: number;
	maxGapMs?: number;
	record(elapsedMs: number): void;
	snapshot(): CursorSdkEventTimingSnapshot;
};

export interface CursorSdkEventJsonlSink {
	appendStream(event: unknown): void;
	appendDelta(update: unknown): void;
	appendStep(step: unknown): void;
	getSummaryState(): {
		counts: {
			stream: Record<string, number>;
			onDelta: Record<string, number>;
			onStep: Record<string, number>;
		};
		timing: {
			stream: CursorSdkEventTimingSnapshot;
			onDelta: CursorSdkEventTimingSnapshot;
			onStep: CursorSdkEventTimingSnapshot;
		};
	};
	close(): Promise<void>;
}

export declare function createEventJsonlSink(artifactDir: string, startedAt: number): CursorSdkEventJsonlSink;

export declare function buildSummary(input: {
	artifactDir: string;
	counts: CursorSdkEventDebugSummary["counts"];
	timing: CursorSdkEventDebugSummary["timing"];
	waitResult?: { status: string; durationMs: number; result?: string };
	conversation?: unknown;
	includeConversation: boolean;
}): CursorSdkEventDebugSummary;
