import { execFileSync } from "node:child_process";

const METADATA_SOURCE = "pi-leader-key";
const NAVIGATION_TOKEN = "pi_leader_key_navigation";
const HERDR_PANE_ID_PATTERN = /^[A-Za-z0-9._:-]+$/;

let openOverlayCount = 0;

function currentHerdrPaneId(): string | null {
	const paneId = process.env.HERDR_PANE_ID;
	return paneId && HERDR_PANE_ID_PATTERN.test(paneId) ? paneId : null;
}

function reportNavigationState(paneId: string, open: boolean): void {
	const stateArg = open
		? ["--token", `${NAVIGATION_TOKEN}=${process.pid}`]
		: ["--clear-token", NAVIGATION_TOKEN];

	try {
		execFileSync(
			process.env.HERDR_BIN_PATH || "herdr",
			["pane", "report-metadata", paneId, "--source", METADATA_SOURCE, ...stateArg],
			{ stdio: "ignore" },
		);
	} catch {
		// Herdr is optional. The menu must still open outside Herdr or if its CLI is unavailable.
	}
}

export async function withHerdrNavigationPassthrough<T>(showOverlay: () => Promise<T>): Promise<T> {
	const paneId = currentHerdrPaneId();
	if (!paneId) return showOverlay();

	if (openOverlayCount === 0) reportNavigationState(paneId, true);
	openOverlayCount++;

	try {
		return await showOverlay();
	} finally {
		openOverlayCount--;
		if (openOverlayCount === 0) reportNavigationState(paneId, false);
	}
}

export function clearHerdrNavigationPassthrough(): void {
	const paneId = currentHerdrPaneId();
	openOverlayCount = 0;
	if (paneId) reportNavigationState(paneId, false);
}
