export interface VccSections {
	sessionGoal: string[];
	filesAndChanges: string[];
	outstandingContext: string[];
	userPreferences: string[];
	briefTranscript: string;
}

export function normalize(messages: readonly unknown[]): unknown[];
export function filterNoise(blocks: unknown[]): unknown[];
export function buildSections(input: { blocks: unknown[] }): VccSections;
export function sanitize(text: string): string;
export function redact(text: string): string;
