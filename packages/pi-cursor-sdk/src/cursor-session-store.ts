import { createHash, randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, toNamespacedPath } from "node:path";
import type { LocalAgentStore } from "@cursor/sdk";
import { loadCursorSdk } from "./cursor-sdk-runtime.js";

export interface CursorSessionStoreIdentity {
	readonly version: 1;
	readonly stateRoot: string;
}

export interface OpenCursorSessionStore {
	identity: CursorSessionStoreIdentity;
	store: LocalAgentStore;
	dispose(): Promise<void>;
}

export interface CursorSessionStoreSelection {
	sessionStore: OpenCursorSessionStore;
	identities: {
		defaultStore: CursorSessionStoreIdentity;
		sessionStore: CursorSessionStoreIdentity;
	};
	resumeAttemptAllowed: boolean;
	resumeFallback: boolean;
}

interface CursorSessionStoreSdkOperations {
	getDefaultStateRoot(cwd: string): string | Promise<string>;
	openSqliteStore(options: { workspaceRef: string; stateRoot: string }): Promise<LocalAgentStore & { dispose(): Promise<void> }>;
}

let sdkOperationsForTests: CursorSessionStoreSdkOperations | undefined;

export function hashCursorSessionStoreScope(scopeKey: string): string {
	return createHash("sha256")
		.update("pi-cursor-sdk-session-store\0")
		.update(scopeKey)
		.digest("hex")
		.slice(0, 32);
}

export function buildCursorSessionStateRoot(defaultStateRoot: string, scopeKey: string, persistent: boolean): string {
	const baseRoot = persistent ? defaultStateRoot : join(tmpdir(), `pi-cursor-sdk-${randomUUID()}`);
	return join(baseRoot, "pi-sessions", hashCursorSessionStoreScope(scopeKey));
}

async function getSdkOperations(): Promise<CursorSessionStoreSdkOperations> {
	if (sdkOperationsForTests) return sdkOperationsForTests;
	const [{ getDefaultSdkStateRoot }, { SqliteLocalAgentStore }] = await Promise.all([
		loadCursorSdk(),
		import("@cursor/sdk/sqlite"),
	]);
	return {
		getDefaultStateRoot: getDefaultSdkStateRoot,
		openSqliteStore: (options) => SqliteLocalAgentStore.open(options),
	};
}

export async function getCursorSessionStoreIdentities(
	cwd: string,
	scopeKey: string,
	persistent: boolean,
): Promise<{ defaultStore: CursorSessionStoreIdentity; sessionStore: CursorSessionStoreIdentity }> {
	const defaultStateRoot = await (await getSdkOperations()).getDefaultStateRoot(cwd);
	return {
		defaultStore: { version: 1, stateRoot: defaultStateRoot },
		sessionStore: {
			version: 1,
			stateRoot: buildCursorSessionStateRoot(defaultStateRoot, scopeKey, persistent),
		},
	};
}

export function cursorSessionStoreIdentitiesEqual(
	left: CursorSessionStoreIdentity,
	right: CursorSessionStoreIdentity,
): boolean {
	return left.version === right.version && left.stateRoot === right.stateRoot;
}

async function openOwnedCursorSessionStore(
	cwd: string,
	identity: CursorSessionStoreIdentity,
	removalRoot?: string,
): Promise<OpenCursorSessionStore> {
	const openedIdentity = Object.freeze({ ...identity });
	let store: LocalAgentStore & { dispose(): Promise<void> };
	try {
		store = await (await getSdkOperations()).openSqliteStore({
			workspaceRef: cwd,
			stateRoot: toNamespacedPath(openedIdentity.stateRoot),
		});
	} catch (error) {
		if (removalRoot) await rm(removalRoot, { recursive: true, force: true }).catch(() => undefined);
		throw error;
	}
	return {
		identity: openedIdentity,
		store,
		dispose: async () => {
			try {
				await store.dispose();
			} finally {
				if (removalRoot) await rm(removalRoot, { recursive: true, force: true });
			}
		},
	};
}

export function openCursorSessionStore(
	cwd: string,
	identity: CursorSessionStoreIdentity,
): Promise<OpenCursorSessionStore> {
	return openOwnedCursorSessionStore(cwd, identity);
}

export async function openCursorSessionStoreForScope(options: {
	cwd: string;
	scopeKey: string;
	persistent: boolean;
	hasResumeHandle: boolean;
	resumeIdentity?: CursorSessionStoreIdentity;
}): Promise<CursorSessionStoreSelection> {
	const identities = await getCursorSessionStoreIdentities(options.cwd, options.scopeKey, options.persistent);
	const requestedResumeIdentity = options.hasResumeHandle
		? options.resumeIdentity ?? (options.persistent ? identities.defaultStore : undefined)
		: undefined;
	const resumableIdentities = options.persistent
		? [identities.defaultStore, identities.sessionStore]
		: [identities.sessionStore];
	const resumeIdentity = requestedResumeIdentity && resumableIdentities
		.find((identity) => cursorSessionStoreIdentitiesEqual(identity, requestedResumeIdentity));
	let resumeAttemptAllowed = options.hasResumeHandle && resumeIdentity !== undefined;
	let resumeFallback = options.persistent && options.hasResumeHandle && !resumeIdentity;
	const selectedIdentity = resumeIdentity ?? identities.sessionStore;
	const removalRoot = options.persistent ? undefined : dirname(dirname(identities.sessionStore.stateRoot));
	let sessionStore: OpenCursorSessionStore;
	try {
		sessionStore = await openOwnedCursorSessionStore(options.cwd, selectedIdentity, removalRoot);
	} catch (error) {
		if (!resumeIdentity || cursorSessionStoreIdentitiesEqual(resumeIdentity, identities.sessionStore)) throw error;
		resumeAttemptAllowed = false;
		resumeFallback = true;
		sessionStore = await openOwnedCursorSessionStore(options.cwd, identities.sessionStore);
	}
	return { sessionStore, identities, resumeAttemptAllowed, resumeFallback };
}

export const __testUtils = {
	setSdkOperations(operations: CursorSessionStoreSdkOperations | undefined): void {
		sdkOperationsForTests = operations;
	},
};
