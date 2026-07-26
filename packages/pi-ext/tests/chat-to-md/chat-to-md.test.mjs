import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import chatToMarkdown, {
	extractLastAssistantText,
	formatLocalDate,
	saveLastResponse,
	slugifyResponse,
} from "../../extensions/chat-to-md/index.ts";

const temporaryDirectories = [];

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map((directory) =>
		rm(directory, { recursive: true, force: true })
	));
});

function messageEntry(role, content) {
	return {
		type: "message",
		id: Math.random().toString(16).slice(2, 10),
		parentId: null,
		timestamp: new Date().toISOString(),
		message: { role, content },
	};
}

function fakeContext(entries, notifications) {
	return {
		cwd: "/repo/subdirectory",
		isIdle: () => true,
		sessionManager: { getBranch: () => entries },
		ui: { notify: (message, level) => notifications.push({ message, level }) },
	};
}

describe("chat-to-md helpers", () => {
	it("extracts text blocks from the latest textual assistant message", () => {
		const entries = [
			messageEntry("assistant", [{ type: "text", text: "Older answer" }]),
			messageEntry("user", "Continue"),
			messageEntry("assistant", [
				{ type: "text", text: "Latest answer" },
				{ type: "thinking", thinking: "hidden" },
				{ type: "text", text: "Second paragraph" },
			]),
		];

		assert.equal(extractLastAssistantText(entries), "Latest answer\n\nSecond paragraph");
	});

	it("builds a short Markdown-safe title slug", () => {
		assert.equal(
			slugifyResponse("## Fixed the naïve race condition in `saveChat()`\n\nDetails"),
			"fixed-the-naive-race-condition-in-savechat",
		);
		assert.equal(slugifyResponse("```ts\n```"), "response");
		assert.equal(formatLocalDate(new Date(2026, 5, 24)), "2026-06-24");
	});
});

describe("chat-to-md extension", () => {
	it("does not capture a stale response while the agent is running", async () => {
		const notifications = [];
		const ctx = {
			...fakeContext([messageEntry("assistant", [{ type: "text", text: "Old response" }])], notifications),
			isIdle: () => false,
		};
		const pi = { exec: async () => assert.fail("git should not run while busy") };

		assert.equal(await saveLastResponse(pi, ctx), undefined);
		assert.deepEqual(notifications, [{
			message: "Wait for the current response to finish",
			level: "warning",
		}]);
	});

	it("writes to the repository ai-artifacts/chat directory without overwriting", async () => {
		const root = await mkdtemp(join(tmpdir(), "chat-to-md-"));
		temporaryDirectories.push(root);
		const notifications = [];
		const entries = [messageEntry("assistant", [{ type: "text", text: "Fixed the race condition.\n\nDetails." }])];
		const pi = {
			exec: async (command, args, options) => {
				assert.equal(command, "git");
				assert.deepEqual(args, ["rev-parse", "--show-toplevel"]);
				assert.equal(options.cwd, "/repo/subdirectory");
				return { stdout: `${root}\n`, stderr: "", code: 0, killed: false };
			},
		};
		const ctx = fakeContext(entries, notifications);
		const now = new Date(2026, 5, 24, 12, 0, 0);

		const first = await saveLastResponse(pi, ctx, now);
		const second = await saveLastResponse(pi, ctx, now);

		assert.equal(first, join(root, "ai-artifacts/chat/2026-06-24-fixed-the-race-condition.md"));
		assert.equal(second, join(root, "ai-artifacts/chat/2026-06-24-fixed-the-race-condition-2.md"));
		assert.equal(await readFile(first, "utf8"), "Fixed the race condition.\n\nDetails.\n");
		assert.deepEqual(notifications.at(-1), {
			message: "Saved ai-artifacts/chat/2026-06-24-fixed-the-race-condition-2.md",
			level: "info",
		});
	});

	it("registers /chat-to-md and waits for idle before saving", async () => {
		const root = await mkdtemp(join(tmpdir(), "chat-to-md-command-"));
		temporaryDirectories.push(root);
		let registered;
		let waited = false;
		const notifications = [];
		const pi = {
			registerCommand: (name, options) => { registered = { name, ...options }; },
			exec: async () => ({ stdout: `${root}\n`, stderr: "", code: 0, killed: false }),
		};
		chatToMarkdown(pi);

		assert.equal(registered.name, "chat-to-md");
		await registered.handler("", {
			...fakeContext([messageEntry("assistant", [{ type: "text", text: "Ship it" }])], notifications),
			waitForIdle: async () => { waited = true; },
		});

		assert.equal(waited, true);
		assert.match(notifications[0].message, /^Saved ai-artifacts\/chat\/\d{4}-\d{2}-\d{2}-ship-it\.md$/);
	});
});
