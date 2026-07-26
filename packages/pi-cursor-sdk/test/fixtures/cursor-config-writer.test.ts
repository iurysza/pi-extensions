import { existsSync, writeFileSync } from "node:fs";
import { describe, it } from "vitest";
import { updateCursorSdkConfig } from "../../src/cursor-config.js";

const configPath = process.env.PI_CURSOR_CONFIG_WRITER_PATH;
const gatePath = process.env.PI_CURSOR_CONFIG_WRITER_GATE;
const writerKey = process.env.PI_CURSOR_CONFIG_WRITER_KEY;
const waitBuffer = new Int32Array(new SharedArrayBuffer(4));

describe("cursor config writer fixture", () => {
	it.skipIf(!configPath || !gatePath || !writerKey)("updates one field under the shared config lock", () => {
		writeFileSync(`${gatePath}.${writerKey}.started`, "");
		updateCursorSdkConfig(
			configPath!,
			(current) => {
				writeFileSync(`${gatePath}.${writerKey}.ready`, "");
				const deadline = Date.now() + 15_000;
				while (!existsSync(gatePath!)) {
					if (Date.now() >= deadline) throw new Error("writer gate timed out");
					Atomics.wait(waitBuffer, 0, 0, 20);
				}
				return { ...current, [writerKey!]: true };
			},
			{ newFileMode: 0o600 },
		);
	}, 20_000);
});
