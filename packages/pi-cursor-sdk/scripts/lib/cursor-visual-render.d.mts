export declare function buildTerminalHtml(args: {
	ansi: string;
	plain: string;
	options: {
		label: string;
		model: string;
		mode: string;
		cwd: string;
		sessionId: string;
		width: number;
		height: number;
		historyLines: number;
	};
}): string;
export declare function writeTerminalScreenshot(htmlPath: string, pngPath: string, width: number, height: number): Promise<void>;
