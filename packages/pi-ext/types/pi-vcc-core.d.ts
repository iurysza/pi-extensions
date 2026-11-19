/** Mirrors SectionData in @sting8k/pi-vcc 0.11.2 (src/sections.ts). */
export interface VccSections {
	earlyRequests: string[];
	filesAndChanges: string[];
	commits: string[];
	userMessages: string[];
	trackedCommands: string[];
	briefTranscript: string;
}

export function normalize(messages: readonly unknown[]): unknown[];
export function filterNoise(blocks: unknown[]): unknown[];
export function buildSections(input: { blocks: unknown[] }): VccSections;
export function sanitize(text: string): string;
