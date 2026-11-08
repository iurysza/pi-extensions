/** Compatibility entrypoint for the former cmux-specific command. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { CmuxClient } from "./cmux-client.js";
import registerSplitFork from "../split-fork/index.js";

export function wireSplitFork(pi: ExtensionAPI, _client: CmuxClient): void {
	registerSplitFork(pi);
}
