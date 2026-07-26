type AnchoredArtifactFile = {
	path: string;
	content: Uint8Array;
};

export function writeExtractedFilesAnchored(
	outputDir: string,
	files: readonly AnchoredArtifactFile[],
	expectedRoot: { dev: number | bigint; ino: number | bigint },
): boolean;
