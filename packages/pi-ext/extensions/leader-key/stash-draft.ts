import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { copyToClipboard } from "../pi-telescope/clipboard.js";

type EditorUI = Pick<ExtensionContext["ui"], "getEditorText" | "setEditorText" | "notify">;

/** Clear the editor only after the clipboard confirms the full text was copied. */
export function stashDraft(ui: EditorUI, copy: (text: string) => boolean = copyToClipboard): void {
	const text = ui.getEditorText();
	if (!text) {
		ui.notify("Nothing to stash", "info");
		return;
	}
	if (!copy(text)) {
		ui.notify("Clipboard copy failed; draft left in the editor", "error");
		return;
	}
	ui.setEditorText("");
	ui.notify("Draft copied to clipboard. Paste to restore it.", "info");
}
