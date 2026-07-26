import type { ChildProcess } from "node:child_process";

export type CloudSmokeShutdownController = {
	signal: AbortSignal;
	track(child: ChildProcess): Promise<() => void>;
	request(signalName: string): Promise<Error>;
	readonly reason: Error | undefined;
	wait(): Promise<void>;
	throwIfRequested(): void;
};

export function createCloudSmokeShutdownController(
	terminate: (child: ChildProcess) => void | Promise<void>,
): CloudSmokeShutdownController;

export function awaitCloudSmokeShutdown(
	shutdown: CloudSmokeShutdownController,
	tracking?: Promise<unknown>,
): Promise<Error>;

export function checkpointCloudSmokeShutdown(
	shutdown: CloudSmokeShutdownController,
): Promise<void>;

export function createCloudSmokeTerminalFailureState(
	rejectPending: (error: Error) => void,
): {
	record(error: Error): void;
	throwIfFailed(): void;
};

export function stopCloudSmokeTrackedChild(
	shutdown: CloudSmokeShutdownController,
	tracking: Promise<unknown>,
	terminateChild: () => void | Promise<void>,
): Promise<Error | undefined>;

export function routeCloudSmokeChildError(
	shutdown: CloudSmokeShutdownController,
	onShutdown: () => void,
	onError: (error: Error) => void,
	error: Error,
): void;

export function installCloudSmokeChildErrorHandlers(
	child: ChildProcess,
	shutdown: CloudSmokeShutdownController,
	onShutdown: () => void,
	onError: (error: Error) => void,
): (error: Error) => void;

export function routeCloudSmokeChildClose<T>(
	shutdown: CloudSmokeShutdownController,
	timedOut: boolean,
	onShutdown: () => void,
	onClose: (result: T) => void,
	result: T,
): void;

export function installCloudSmokeSignalHandlers(
	shutdown: CloudSmokeShutdownController,
	processLike?: {
		on(signalName: string, handler: () => void): unknown;
		off(signalName: string, handler: () => void): unknown;
	},
	onSignal?: (signalName: string) => void,
): () => void;
