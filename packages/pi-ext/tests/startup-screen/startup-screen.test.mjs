import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import startupScreen, {
	formatStartupPath,
	renderStartupHeader,
} from "../../extensions/startup-screen/index.ts";

function fakeTheme(roles = []) {
	return {
		fg(role, text) {
			roles.push(role);
			return text;
		},
		bold(text) {
			return text;
		},
	};
}

describe("startup screen rendering", () => {
	it("formats home-relative paths and removes terminal control characters", () => {
		assert.equal(formatStartupPath("/home/iury", "/home/iury"), "~");
		assert.equal(formatStartupPath("/home/iury/dev/project", "/home/iury"), "~/dev/project");
		assert.equal(
			formatStartupPath("/home/iury/dev/\u001b]0;owned\u0007project", "/home/iury"),
			"~/dev/]0;ownedproject",
		);
	});

	it("renders the full wordmark with active theme roles", () => {
		const roles = [];
		const lines = renderStartupHeader(40, fakeTheme(roles), "/workspace/project");

		assert.equal(lines.length, 10);
		assert.equal(lines.at(-3), "");
		assert.ok(lines.some((line) => line.includes("██████")));
		assert.ok(lines.some((line) => line.includes("/workspace/project")));
		assert.ok(roles.includes("mdLink"));
		assert.ok(roles.includes("mdHeading"));
		assert.ok(roles.includes("accent"));
		assert.ok(roles.includes("syntaxVariable"));
		assert.ok(lines.every((line) => visibleWidth(line) <= 40));
	});

	it("falls back to a compact mark on narrow terminals", () => {
		const lines = renderStartupHeader(8, fakeTheme(), "/very/long/project/path");

		assert.equal(lines.length, 5);
		assert.equal(lines.at(-3), "");
		assert.ok(lines.includes("   π"));
		assert.ok(lines.every((line) => visibleWidth(line) <= 8));
	});
});

describe("startup screen extension", () => {
	it("owns only the TUI header for the session lifecycle", () => {
		const handlers = new Map();
		const pi = { on: (event, handler) => handlers.set(event, handler) };
		const headerChanges = [];
		const ctx = {
			cwd: "/repo",
			mode: "tui",
			ui: { setHeader: (value) => headerChanges.push(value) },
		};

		startupScreen(pi);
		handlers.get("session_start")({}, ctx);
		assert.equal(typeof headerChanges[0], "function");

		const component = headerChanges[0]({}, fakeTheme());
		assert.ok(component.render(80).some((line) => line.includes("/repo")));

		handlers.get("session_shutdown")({}, ctx);
		assert.equal(headerChanges.at(-1), undefined);
	});

	it("does nothing outside TUI mode", () => {
		const handlers = new Map();
		const pi = { on: (event, handler) => handlers.set(event, handler) };
		let changed = false;
		const ctx = {
			cwd: "/repo",
			mode: "print",
			ui: { setHeader: () => { changed = true; } },
		};

		startupScreen(pi);
		handlers.get("session_start")({}, ctx);
		handlers.get("session_shutdown")({}, ctx);
		assert.equal(changed, false);
	});
});
