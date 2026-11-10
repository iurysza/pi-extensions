import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readCursorSdkEsmBundleContaining } from "./helpers/installed-package.js";
import {
	cursorMcpToolTimeoutOverrideDefaults,
	installCursorMcpToolTimeoutOverride,
	isCursorSdkMcpConnectTimeoutStack,
	isCursorSdkMcpToolTimeoutStack,
	resolveCursorMcpConnectTimeoutMs,
	resolveCursorMcpToolTimeoutMs,
	restoreCursorMcpToolTimeoutOverride,
} from "../src/cursor-mcp-timeout-override.js";

afterEach(() => {
	restoreCursorMcpToolTimeoutOverride();
	vi.useRealTimers();
});

function scheduleSyntheticCursorSdkMcpListToolsTimeout(callback: () => void): ReturnType<typeof setTimeout> {
	const sdkUrl = pathToFileURL(join(process.cwd(), "node_modules/@cursor/sdk/dist/esm/index.js")).href;
	const source = `
return (() => {
	class Protocol {
		_setupTimeout() {
			return setTimeout(callback, 60000);
		}

		request() {
			return this._setupTimeout();
		}
	}

	class Client extends Protocol {
		listTools() {
			return this.request();
		}
	}

	class McpSdkClient {
		constructor() {
			this.client = new Client();
		}

		getTools() {
			return this.client.listTools();
		}
	}

	return new McpSdkClient().getTools();
})();
//# sourceURL=${sdkUrl}
`;
	const run = new Function("callback", source) as (callback: () => void) => ReturnType<typeof setTimeout>;
	return run(callback);
}

function scheduleSyntheticCursorSdkMcpInitializeTimeout(callback: () => void): ReturnType<typeof setTimeout> {
	const sdkUrl = pathToFileURL(join(process.cwd(), "node_modules/@cursor/sdk/dist/esm/index.js")).href;
	const source = `
return (() => {
	class Protocol {
		_setupTimeout() {
			return setTimeout(callback, 60000);
		}

		request() {
			return this._setupTimeout();
		}
	}

	class Client extends Protocol {
		connect() {
			return this.request();
		}
	}

	return new Client().connect();
})();
//# sourceURL=${sdkUrl}
`;
	const run = new Function("callback", source) as (callback: () => void) => ReturnType<typeof setTimeout>;
	return run(callback);
}

function scheduleSyntheticCursorSdkMcpUnknownProtocolTimeout(callback: () => void): ReturnType<typeof setTimeout> {
	const sdkUrl = pathToFileURL(join(process.cwd(), "node_modules/@cursor/sdk/dist/esm/index.js")).href;
	const source = `
return (() => {
	class Protocol {
		_setupTimeout() {
			return setTimeout(callback, 60000);
		}

		request() {
			return this._setupTimeout();
		}
	}

	class Client extends Protocol {
		listPrompts() {
			return this.request();
		}
	}

	return new Client().listPrompts();
})();
//# sourceURL=${sdkUrl}
`;
	const run = new Function("callback", source) as (callback: () => void) => ReturnType<typeof setTimeout>;
	return run(callback);
}

function scheduleSyntheticCursorSdkMcpToolTimeout(callback: () => void): ReturnType<typeof setTimeout> {
	const sdkUrl = pathToFileURL(join(process.cwd(), "node_modules/@cursor/sdk/dist/esm/index.js")).href;
	const source = `
return (() => {
	class Protocol {
		_setupTimeout() {
			return setTimeout(callback, 60000);
		}

		request() {
			return this._setupTimeout();
		}
	}

	class Client extends Protocol {
		callTool() {
			return this.request();
		}
	}

	class McpSdkClient {
		constructor() {
			this.client = new Client();
		}

		callTool() {
			return this.client.callTool();
		}
	}

	return new McpSdkClient().callTool();
})();
//# sourceURL=${sdkUrl}
`;
	const run = new Function("callback", source) as (callback: () => void) => ReturnType<typeof setTimeout>;
	return run(callback);
}

describe("Cursor MCP timeout override", () => {
	it("tracks the installed Cursor SDK MCP callTool timeout seam", () => {
		const sdkMcpBundle = readCursorSdkEsmBundleContaining(
			'withName("McpSdkClient.callTool")',
			"this.client.callTool(e,void 0,n)",
		);
		const sdkProtocolBundle = readCursorSdkEsmBundleContaining(
			'this.request({method:"initialize"',
			"timeoutId:setTimeout",
		);

		expect(sdkMcpBundle).toContain('withName("McpSdkClient.callTool")');
		// 1.3.1 still forwards request options and the abort signal through sendToolCall.
		// Output-schema passthrough is opt-in; the default branch remains client.callTool.
		expect(sdkMcpBundle).toContain("this.sendToolCall({name:t,arguments:r},s.signal)");
		expect(sdkMcpBundle).toContain("sendToolCall(e,t){const r=this._toolCallRequestOptions?.(e.name),n={...r,signal:void 0===r?.signal?t:AbortSignal.any([r.signal,t])}");
		expect(sdkMcpBundle).toContain('!0===this._toolCallOutputSchemaPassthrough?.()?this.client.request({method:"tools/call",params:e},zb.TF,n):this.client.callTool(e,void 0,n)');
		expect(sdkMcpBundle).toContain('withName("McpSdkClient.getTools")');
		// Paginated discovery still uses Client.listTools, now inside a schema-repair helper.
		expect(sdkMcpBundle).toContain('async function(e,t,r){try{const r=await e.listTools({cursor:t});return{tools:r.tools,nextCursor:r.nextCursor');
		expect(sdkMcpBundle).toContain('}(this.client,e,((e,t,n)=>{');
		expect(sdkProtocolBundle).toContain('this.request({method:"initialize"');
		expect(sdkProtocolBundle).toContain('_setupTimeout(e,t,s,n,r=!1)');
		expect(sdkProtocolBundle).toContain('timeoutId:setTimeout(n,t)');
		expect(sdkProtocolBundle).toContain('const g=s?.timeout??6e4;this._setupTimeout(p,g,s?.maxTotalTimeout');
		expect(sdkProtocolBundle).toContain('async listTools(e,t){const s=await this.request({method:"tools/list",params:e},a.WT,t)');
	});

	it("recognizes the Cursor SDK MCP tool-call timeout stack shape", () => {
		const stack = `Error
    at Protocol._setupTimeout (${process.cwd()}/node_modules/@cursor/sdk/dist/esm/index.js:1:1)
    at Client.callTool (${process.cwd()}/node_modules/@cursor/sdk/dist/esm/index.js:1:1)
    at McpSdkClient.callTool (${process.cwd()}/node_modules/@cursor/sdk/dist/esm/index.js:1:1)`;

		const listToolsStack = stack.replace(/callTool/g, "listTools").replace(/McpSdkClient\.listTools/, "McpSdkClient.getTools");
		const initializeStack = stack.replace(/callTool/g, "connect");
		const unknownProtocolStack = stack.replace(/callTool/g, "listPrompts");

		expect(isCursorSdkMcpToolTimeoutStack(stack)).toBe(true);
		expect(isCursorSdkMcpToolTimeoutStack(listToolsStack)).toBe(false);
		expect(isCursorSdkMcpConnectTimeoutStack(listToolsStack)).toBe(true);
		expect(isCursorSdkMcpConnectTimeoutStack(initializeStack)).toBe(true);
		expect(isCursorSdkMcpConnectTimeoutStack(unknownProtocolStack)).toBe(false);
		expect(isCursorSdkMcpConnectTimeoutStack(stack)).toBe(false);
		expect(isCursorSdkMcpToolTimeoutStack(stack.replace(/node_modules\/\@cursor\/sdk/g, "src"))).toBe(false);
	});

	it("installs the override before Cursor session agent acquisition", async () => {
		vi.resetModules();
		const calls: string[] = [];
		vi.doMock("../src/cursor-mcp-timeout-override.js", () => ({
			installCursorMcpToolTimeoutOverride: () => calls.push("install"),
		}));
		vi.doMock("../src/cursor-session-agent.js", () => ({
			acquireSessionCursorAgent: async () => {
				calls.push("acquire");
				throw new Error("stop before Cursor agent creation");
			},
			buildCursorSessionSendPrompt: vi.fn(),
			planCursorSessionSend: vi.fn(),
			resetSessionCursorAgent: vi.fn(),
		}));
		const { prepareCursorProviderTurn, resolveCursorProviderTurnConfig } = await import("../src/cursor-provider-turn-prepare.js");

		await expect(
			prepareCursorProviderTurn({
				params: {
					model: { id: "cursor/composer-2.5", provider: "cursor", api: "assistant" } as never,
					context: {} as never,
					stream: { push: vi.fn() } as never,
					partial: { content: [] } as never,
					sdkEventDebugRef: {},
				},
				cwd: process.cwd(),
				resolvedApiKey: "key",
				sdkEventDebug: undefined,
				throwIfAborted: vi.fn(),
				resolvedConfig: resolveCursorProviderTurnConfig(process.cwd()),
			}),
		).rejects.toThrow("stop before Cursor agent creation");

		expect(calls).toEqual(["install", "acquire"]);
		vi.doUnmock("../src/cursor-mcp-timeout-override.js");
		vi.doUnmock("../src/cursor-session-agent.js");
		vi.resetModules();
	}, 15_000);

	it("extends only the Cursor SDK MCP tool-call default timeout", () => {
		vi.useFakeTimers();
		installCursorMcpToolTimeoutOverride({ timeoutMs: 3_600_000 });
		const callback = vi.fn();

		scheduleSyntheticCursorSdkMcpToolTimeout(callback);

		vi.advanceTimersByTime(60_000);
		expect(callback).not.toHaveBeenCalled();

		vi.advanceTimersByTime(3_600_000 - 60_000);
		expect(callback).toHaveBeenCalledTimes(1);
	});

	it("shortens known Cursor SDK MCP initialize and listTools default timeouts", () => {
		vi.useFakeTimers();
		installCursorMcpToolTimeoutOverride({ connectTimeoutMs: 10_000 });
		const listToolsCallback = vi.fn();
		const initializeCallback = vi.fn();

		scheduleSyntheticCursorSdkMcpListToolsTimeout(listToolsCallback);
		scheduleSyntheticCursorSdkMcpInitializeTimeout(initializeCallback);

		vi.advanceTimersByTime(9_999);
		expect(listToolsCallback).not.toHaveBeenCalled();
		expect(initializeCallback).not.toHaveBeenCalled();

		vi.advanceTimersByTime(1);
		expect(listToolsCallback).toHaveBeenCalledTimes(1);
		expect(initializeCallback).toHaveBeenCalledTimes(1);
	});

	it("does not shorten unknown Cursor SDK MCP protocol default timeouts", () => {
		vi.useFakeTimers();
		installCursorMcpToolTimeoutOverride({ connectTimeoutMs: 10_000 });
		const callback = vi.fn();

		scheduleSyntheticCursorSdkMcpUnknownProtocolTimeout(callback);

		vi.advanceTimersByTime(10_000);
		expect(callback).not.toHaveBeenCalled();

		vi.advanceTimersByTime(50_000);
		expect(callback).toHaveBeenCalledTimes(1);
	});

	it("uses a 10s connect default and supports explicit connect overrides", () => {
		expect(resolveCursorMcpConnectTimeoutMs({})).toBe(
			cursorMcpToolTimeoutOverrideDefaults.defaultConnectTimeoutMs,
		);
		expect(
			resolveCursorMcpConnectTimeoutMs({
				[cursorMcpToolTimeoutOverrideDefaults.connectTimeoutSecondsEnv]: "5",
			}),
		).toBe(5_000);
		expect(
			resolveCursorMcpConnectTimeoutMs({
				[cursorMcpToolTimeoutOverrideDefaults.connectTimeoutMsEnv]: "500",
			}),
		).toBe(cursorMcpToolTimeoutOverrideDefaults.minConnectTimeoutMs);
		expect(
			resolveCursorMcpConnectTimeoutMs({
				[cursorMcpToolTimeoutOverrideDefaults.connectTimeoutMsEnv]: "120000",
			}),
		).toBe(cursorMcpToolTimeoutOverrideDefaults.cursorSdkDefaultTimeoutMs);
	});

	it("does not extend unrelated 60s timers", () => {
		vi.useFakeTimers();
		installCursorMcpToolTimeoutOverride({ timeoutMs: 3_600_000 });
		const callback = vi.fn();

		setTimeout(callback, 60_000);

		vi.advanceTimersByTime(60_000);
		expect(callback).toHaveBeenCalledTimes(1);
	});

	it("keeps non-default timer calls on the cheap no-stack fast path", () => {
		vi.useFakeTimers();
		installCursorMcpToolTimeoutOverride({ timeoutMs: 3_600_000 });
		const OriginalError = globalThis.Error;
		let stackCaptures = 0;
		const CountingError = class extends OriginalError {
			constructor(message?: string) {
				super(message);
				stackCaptures += 1;
			}
		} as ErrorConstructor;
		globalThis.Error = CountingError;
		try {
			setTimeout(vi.fn(), 1);
			expect(stackCaptures).toBe(0);

			setTimeout(vi.fn(), 60_000);
			expect(stackCaptures).toBe(1);
		} finally {
			globalThis.Error = OriginalError;
		}
	});

	it("uses a 3600s default and supports explicit second or millisecond overrides", () => {
		expect(resolveCursorMcpToolTimeoutMs({})).toBe(
			cursorMcpToolTimeoutOverrideDefaults.defaultOverrideTimeoutMs,
		);
		expect(
			resolveCursorMcpToolTimeoutMs({
				[cursorMcpToolTimeoutOverrideDefaults.timeoutSecondsEnv]: "120",
			}),
		).toBe(120_000);
		expect(
			resolveCursorMcpToolTimeoutMs({
				[cursorMcpToolTimeoutOverrideDefaults.timeoutMsEnv]: "250000",
				[cursorMcpToolTimeoutOverrideDefaults.timeoutSecondsEnv]: "120",
			}),
		).toBe(250_000);
		expect(
			resolveCursorMcpToolTimeoutMs({
				[cursorMcpToolTimeoutOverrideDefaults.timeoutMsEnv]: "999999999999",
			}),
		).toBe(cursorMcpToolTimeoutOverrideDefaults.maxNodeTimerDelayMs);
	});
});
