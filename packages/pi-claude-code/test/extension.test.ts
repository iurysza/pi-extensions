import { describe, expect, it, vi } from "vitest";
import claudeCodeExtension, { CLAUDE_CODE_API_KEY_PLACEHOLDER } from "../src/index.js";
import { claudeCodeStatus } from "../src/claude-code-status.js";
import { runTurn } from "../src/claude-code-turn.js";
import { buildTurnRequest } from "../src/claude-code-request.js";
import { startFakeUpstream, sse } from "./fixtures/fake-upstream.js";
import { testModel, testRuntime, user } from "./helpers.js";

function fakePi() {
	const providers = new Map<string, any>();
	const commands = new Map<string, any>();
	const handlers = new Map<string, Function>();
	return {
		providers,
		commands,
		handlers,
		api: {
			registerProvider: (name: string, config: any) => providers.set(name, config),
			registerCommand: (name: string, options: any) => commands.set(name, options),
			on: (event: string, handler: Function) => handlers.set(event, handler),
		} as any,
	};
}

describe("extension registration", () => {
	it("registers the provider, two commands, and a shutdown handler", () => {
		const pi = fakePi();
		claudeCodeExtension(pi.api);
		const config = pi.providers.get("claude-code");
		expect(config).toMatchObject({ name: "Claude Code", api: "claude-code-cli", apiKey: CLAUDE_CODE_API_KEY_PLACEHOLDER });
		expect(config.models.map((model: any) => model.id)).toContain("claude-opus-5-5");
		expect(typeof config.streamSimple).toBe("function");
		expect(typeof config.refreshModels).toBe("function");
		expect([...pi.commands.keys()]).toEqual(["claude-code-status", "claude-code-refresh-models"]);
		expect(pi.handlers.has("session_shutdown")).toBe(true);
	});

	it("forces one refresh from the refresh command", async () => {
		const pi = fakePi();
		claudeCodeExtension(pi.api);
		const notify = vi.fn();
		const refresh = vi.fn(async () => {});
		await pi.commands.get("claude-code-refresh-models").handler("", {
			hasUI: true,
			ui: { notify },
			modelRegistry: { refresh, getAll: () => [{ provider: "claude-code" }, { provider: "anthropic" }] },
		});
		expect(refresh).toHaveBeenCalledOnce();
		expect(notify).toHaveBeenCalledWith("Claude Code models refreshed: 1 model.", "info");
	});
});

describe("claudeCodeStatus", () => {
	it("reports the CLI, its login, and the last Turn without secrets", async () => {
		const upstream = await startFakeUpstream([sse.text("hi")]);
		try {
			const runtime = testRuntime({ upstream: upstream.url });
			const built = buildTurnRequest(testModel(), { messages: [user("hi")] });
			if (!built.ok) throw new Error("unexpected");
			await runTurn(built.request, runtime, { apply: () => {} });
			const text = await claudeCodeStatus(runtime);
			expect(text).toContain("Version: 2.1.282 (Claude Code)");
			expect(text).toContain("Login: logged in (claude.ai)");
			expect(text).toMatch(/Last turn: stop, \d+ ms, HTTP 200, request req_fake/);
			expect(text).not.toMatch(/sk-ant|admit\//);
		} finally {
			await upstream.close();
		}
	});

	it("reports a missing CLI and blocking overrides", async () => {
		const text = await claudeCodeStatus(testRuntime({ command: "/nonexistent/claude", env: { ANTHROPIC_BASE_URL: "http://proxy" } }));
		expect(text).toContain("CLI: not found");
		expect(text).toContain("Blocked by: ANTHROPIC_BASE_URL");
	});
});
