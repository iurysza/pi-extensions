export interface TurnDiagnostics {
	readonly finishedAt: number;
	readonly durationMs: number;
	readonly outcome: string;
	readonly status?: number;
	readonly requestId?: string;
	readonly denied: number;
	readonly acknowledgments: number;
	readonly skippedTools: readonly string[];
}

const active = new Set<() => void>();
let last: TurnDiagnostics | undefined;

export function registerActiveTurn(stop: () => void): () => void {
	active.add(stop);
	return () => active.delete(stop);
}

export function stopActiveTurns(): void {
	for (const stop of [...active]) stop();
	active.clear();
}

export function recordTurn(diagnostics: TurnDiagnostics): void {
	last = diagnostics;
}

export function lastTurn(): TurnDiagnostics | undefined {
	return last;
}
