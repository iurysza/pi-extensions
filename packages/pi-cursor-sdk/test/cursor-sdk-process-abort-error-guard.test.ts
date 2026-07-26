import { describe, expect, it } from "vitest";
import {
	installCursorSdkProcessErrorGuard,
	installCursorSdkSessionProcessErrorGuard,
} from "../src/cursor-sdk-process-error-guard.js";

function makeCursorSdkRawAbortDomException(): DOMException {
	const error = new DOMException("This operation was aborted", "AbortError");
	error.stack =
		"AbortError: This operation was aborted\n" +
		"    at AbortSignal.abort (/repo/node_modules/@cursor/sdk/dist/esm/996.js:1:5705)\n" +
		"    at Y.onStall (/repo/node_modules/@cursor/sdk/dist/esm/357.js:1:75246)";
	return error;
}

function makeCursorSdkRawAbortError(): Error {
	const error = new Error("This operation was aborted");
	error.name = "AbortError";
	error.stack =
		"AbortError: This operation was aborted\n" +
		"    at abort (/repo/node_modules/@cursor/sdk/dist/esm/index.js:1:1125976)";
	return error;
}

function processListenerCalled(event: "uncaughtException" | "unhandledRejection", error: unknown): boolean {
	let called = false;
	const listener = () => { called = true; };
	process.once(event, listener);
	try {
		if (event === "uncaughtException") process.emit(event, error as Error, "uncaughtException");
		else process.emit(event, error, Promise.resolve());
		return called;
	} finally {
		process.removeListener(event, listener);
	}
}

describe("Cursor SDK raw AbortError process guard", () => {
	it("suppresses a DOMException during a provider turn that declares abort suppression", () => {
		const guard = installCursorSdkProcessErrorGuard();
		guard.suppressAbortErrors();
		try {
			expect(processListenerCalled("uncaughtException", makeCursorSdkRawAbortDomException())).toBe(false);
		} finally {
			guard.dispose();
		}
	});

	it("suppresses the unhandledRejection path", () => {
		const guard = installCursorSdkProcessErrorGuard();
		guard.suppressAbortErrors();
		try {
			expect(processListenerCalled("unhandledRejection", makeCursorSdkRawAbortDomException())).toBe(false);
		} finally {
			guard.dispose();
		}
	});

	it("does not suppress a provider turn that has not declared abort suppression", () => {
		const guard = installCursorSdkProcessErrorGuard();
		try {
			expect(processListenerCalled("uncaughtException", makeCursorSdkRawAbortDomException())).toBe(true);
		} finally {
			guard.dispose();
		}
	});

	it("suppresses a plain Error variant with Cursor SDK provenance", () => {
		const guard = installCursorSdkProcessErrorGuard();
		guard.suppressAbortErrors();
		try {
			expect(processListenerCalled("uncaughtException", makeCursorSdkRawAbortError())).toBe(false);
		} finally {
			guard.dispose();
		}
	});

	it("does not suppress an AbortError without Cursor SDK provenance", () => {
		const guard = installCursorSdkProcessErrorGuard();
		guard.suppressAbortErrors();
		const error = makeCursorSdkRawAbortDomException();
		error.stack = "AbortError: This operation was aborted\n    at abort (/repo/src/app.ts:1:1)";
		try {
			expect(processListenerCalled("uncaughtException", error)).toBe(true);
		} finally {
			guard.dispose();
		}
	});

	it("does not suppress without an active provider turn", () => {
		const guard = installCursorSdkSessionProcessErrorGuard();
		try {
			expect(processListenerCalled("uncaughtException", makeCursorSdkRawAbortDomException())).toBe(true);
		} finally {
			guard.dispose();
		}
	});
});
