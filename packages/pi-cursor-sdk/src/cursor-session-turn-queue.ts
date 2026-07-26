import { CursorLiveRunAbortError } from "./cursor-live-run-coordinator.js";

const turnQueuesByScope = new Map<string, Promise<void>>();

async function waitForPreviousTurn(previous: Promise<void>, signal?: AbortSignal): Promise<void> {
	if (!signal) {
		await previous.catch(() => undefined);
		return;
	}
	if (signal.aborted) throw new CursorLiveRunAbortError();
	await new Promise<void>((resolve, reject) => {
		const onAbort = (): void => {
			reject(new CursorLiveRunAbortError());
		};
		signal.addEventListener("abort", onAbort, { once: true });
		previous.catch(() => undefined).then(() => {
			signal.removeEventListener("abort", onAbort);
			resolve();
		});
	});
}

export async function runExclusiveCursorSessionTurn<T>(scopeKey: string, body: () => Promise<T>, signal?: AbortSignal): Promise<T> {
	const previous = turnQueuesByScope.get(scopeKey);
	let releaseCurrent!: () => void;
	const current = new Promise<void>((resolve) => {
		releaseCurrent = resolve;
	});
	const tail = (previous ?? Promise.resolve()).catch(() => undefined).then(() => current);
	turnQueuesByScope.set(scopeKey, tail);
	void tail.finally(() => {
		if (turnQueuesByScope.get(scopeKey) === tail) {
			turnQueuesByScope.delete(scopeKey);
		}
	});

	try {
		if (previous) await waitForPreviousTurn(previous, signal);
		return await body();
	} finally {
		releaseCurrent();
	}
}

export const __testUtils = {
	reset(): void {
		turnQueuesByScope.clear();
	},
	count(): number {
		return turnQueuesByScope.size;
	},
};
