import { PREVIEW_MAX_BYTES, PREVIEW_MAX_LINES } from "./limits.ts";

export interface PreviewSummary {
	preview: string;
	totalBytes: number;
	totalLines: number;
	truncated: boolean;
}

function safeUtf8(buffer: Buffer): string {
	for (let trim = 0; trim <= Math.min(3, buffer.length); trim++) {
		try {
			return new TextDecoder("utf-8", { fatal: true }).decode(trim ? buffer.subarray(0, -trim) : buffer);
		} catch {
			// A retained byte boundary may split one UTF-8 sequence.
		}
	}
	return buffer.toString("utf8");
}

export class PreviewAccumulator {
	readonly #chunks: Buffer[] = [];
	#previewBytes = 0;
	#previewNewlines = 0;
	#totalBytes = 0;
	#totalNewlines = 0;
	#lastByteWasNewline = false;
	#stopped = false;

	push(chunk: Buffer): void {
		if (chunk.length === 0) return;
		this.#totalBytes += chunk.length;
		for (const byte of chunk) if (byte === 10) this.#totalNewlines++;
		this.#lastByteWasNewline = chunk.at(-1) === 10;
		if (this.#stopped) return;

		let take = Math.min(chunk.length, PREVIEW_MAX_BYTES - this.#previewBytes);
		if (take <= 0) {
			this.#stopped = true;
			return;
		}
		for (let index = 0; index < take; index++) {
			if (chunk[index] === 10 && ++this.#previewNewlines >= PREVIEW_MAX_LINES) {
				take = index + 1;
				this.#stopped = take < chunk.length || this.#totalBytes > this.#previewBytes + take;
				break;
			}
		}
		if (take > 0) {
			this.#chunks.push(chunk.subarray(0, take));
			this.#previewBytes += take;
		}
		if (take < chunk.length || this.#previewBytes >= PREVIEW_MAX_BYTES || this.#previewNewlines >= PREVIEW_MAX_LINES) this.#stopped = true;
	}

	summary(): PreviewSummary {
		const bytes = Buffer.concat(this.#chunks, this.#previewBytes);
		return {
			preview: safeUtf8(bytes),
			totalBytes: this.#totalBytes,
			totalLines: this.#totalBytes === 0 ? 0 : this.#totalNewlines + (this.#lastByteWasNewline ? 0 : 1),
			truncated: this.#totalBytes > this.#previewBytes,
		};
	}
}

export function truncationNotice(summary: PreviewSummary, outputPath: string): string {
	return [
		`[Output truncated at ${PREVIEW_MAX_LINES.toLocaleString("en-US")} lines/${PREVIEW_MAX_BYTES.toLocaleString("en-US")} bytes.]`,
		`Observed ${summary.totalLines.toLocaleString("en-US")} lines/${summary.totalBytes.toLocaleString("en-US")} bytes.`,
		`Full output: ${outputPath}`,
	].join("\n");
}
