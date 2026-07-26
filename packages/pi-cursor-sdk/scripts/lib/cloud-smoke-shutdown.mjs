export function createCloudSmokeShutdownController(terminate) {
	if (typeof terminate !== "function") throw new TypeError("terminate must be a function");
	const activeChildren = new Set();
	const abortController = new AbortController();
	let shutdownPromise;
	let reason;
	let requestedSignal;
	let terminationFailureReason;

	const terminationFailure = (error) => {
		if (terminationFailureReason) return terminationFailureReason;
		terminationFailureReason = new Error(`cloud smoke ${requestedSignal} child termination failed`, { cause: error });
		terminationFailureReason.signal = requestedSignal;
		reason = terminationFailureReason;
		return terminationFailureReason;
	};

	const track = async (child) => {
		if (abortController.signal.aborted) {
			try {
				await terminate(child);
			} catch (error) {
				throw terminationFailure(error);
			}
			throw reason;
		}
		activeChildren.add(child);
		const untrack = () => activeChildren.delete(child);
		child.once?.("close", untrack);
		return untrack;
	};

	const request = async (signalName) => {
		if (!abortController.signal.aborted) {
			requestedSignal = signalName;
			const interruptReason = new Error(`cloud smoke interrupted by ${signalName}`);
			interruptReason.signal = signalName;
			reason = interruptReason;
			const terminations = [...activeChildren].map((child) => Promise.resolve().then(() => terminate(child)));
			shutdownPromise = Promise.allSettled(terminations).then((results) => {
				const failed = results.find((result) => result.status === "rejected");
				if (failed) throw terminationFailure(failed.reason);
			});
			abortController.abort(interruptReason);
		}
		await shutdownPromise;
		return reason;
	};

	return {
		signal: abortController.signal,
		track,
		request,
		get reason() { return reason; },
		wait: () => shutdownPromise ?? Promise.resolve(),
		throwIfRequested() {
			if (abortController.signal.aborted) throw reason;
		},
	};
}

export async function awaitCloudSmokeShutdown(shutdown, tracking = Promise.resolve()) {
	const results = await Promise.allSettled([shutdown.wait(), tracking]);
	const failed = results.find((result) => result.status === "rejected");
	const outcome = failed?.reason ?? shutdown.reason;
	return outcome instanceof Error ? outcome : new Error("cloud smoke shutdown failed", { cause: outcome });
}

export async function checkpointCloudSmokeShutdown(shutdown) {
	await new Promise((resolve) => setImmediate(resolve));
	shutdown.throwIfRequested();
}

export function createCloudSmokeTerminalFailureState(rejectPending) {
	let failure;
	return {
		record(error) {
			failure ??= error;
			rejectPending(failure);
		},
		throwIfFailed() {
			if (failure) throw failure;
		},
	};
}

export async function stopCloudSmokeTrackedChild(shutdown, tracking, terminateChild) {
	const termination = Promise.resolve().then(terminateChild);
	const [terminationResult] = await Promise.allSettled([termination]);
	if (shutdown.signal.aborted) {
		const results = await Promise.allSettled([shutdown.wait(), tracking, termination]);
		const failed = results.find((result) => result.status === "rejected");
		if (failed) throw failed.reason instanceof Error ? failed.reason : new Error("cloud smoke child termination failed", { cause: failed.reason });
		return shutdown.reason;
	}
	if (terminationResult.status === "rejected") throw terminationResult.reason;
	return undefined;
}

export function routeCloudSmokeChildError(shutdown, onShutdown, onError, error) {
	if (shutdown.signal.aborted) onShutdown();
	else onError(error);
}

export function installCloudSmokeChildErrorHandlers(child, shutdown, onShutdown, onError) {
	const routeError = (error) => routeCloudSmokeChildError(shutdown, onShutdown, onError, error);
	child.once("error", routeError);
	child.stdin?.on?.("error", routeError);
	return routeError;
}

export function routeCloudSmokeChildClose(shutdown, timedOut, onShutdown, onClose, result) {
	if (shutdown.signal.aborted) onShutdown();
	else if (!timedOut) onClose(result);
}

export function installCloudSmokeSignalHandlers(shutdown, processLike = process, onSignal) {
	const handlers = new Map();
	for (const signalName of ["SIGINT", "SIGTERM"]) {
		const handler = () => {
			try {
				onSignal?.(signalName);
			} finally {
				void shutdown.request(signalName).catch(() => {});
			}
		};
		handlers.set(signalName, handler);
		processLike.on(signalName, handler);
	}
	return () => {
		for (const [signalName, handler] of handlers) processLike.off(signalName, handler);
	};
}
