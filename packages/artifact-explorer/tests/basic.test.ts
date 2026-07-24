import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseCommandArgs } from "../lib/parse-args.js";
import { projectIdForPath, projectNameFromRepo } from "../lib/hash.js";
import { isTransientRelativePath } from "../lib/fs-utils.js";
import { defaultConfig } from "../lib/paths.js";
import {
	buildOpenVaultBridgeArgs,
	buildPluginCommandArgs,
	isCommandStillLoading,
	listEvalVaultCandidates,
} from "../lib/obsidian-cli.js";
import {
	artifactVaultNickname,
	writeVaultNickname,
} from "../lib/profile-sync.js";

describe("configuration", () => {
	it("uses portable defaults without a machine-specific source profile", () => {
		assert.deepEqual(defaultConfig(), {
			sourceProfilePath: "",
			obsidianBinary: "obsidian",
			artifactWorkspaceName: "AI Artifacts",
			hubWorkspaceName: "Artifact Hub",
		});
	});
});

describe("parseCommandArgs", () => {
	it("defaults to open", () => {
		assert.deepEqual(parseCommandArgs(""), { kind: "open" });
		assert.deepEqual(parseCommandArgs("   "), { kind: "open" });
	});

	it("parses subcommands", () => {
		assert.deepEqual(parseCommandArgs("hub"), { kind: "hub" });
		assert.deepEqual(parseCommandArgs("status"), { kind: "status" });
		assert.deepEqual(parseCommandArgs("--help"), { kind: "help" });
	});

	it("returns unknown for unsupported args", () => {
		assert.deepEqual(parseCommandArgs("foo bar"), { kind: "unknown", args: "foo bar" });
	});
});

describe("project identity", () => {
	it("hashes canonical artifact paths deterministically", () => {
		const path = "/tmp/example/ai-artifacts";
		assert.equal(projectIdForPath(path), projectIdForPath(path));
		assert.equal(projectIdForPath(path).length, 16);
	});

	it("derives project names from repo paths", () => {
		assert.equal(projectNameFromRepo("/tmp/me/dev/obsidian-vault"), "obsidian-vault");
	});
});

describe("transient exclusions", () => {
	it("skips logs, askpass scripts, and caches", () => {
		assert.equal(isTransientRelativePath("plugins/foo/cache/bar.json"), true);
		assert.equal(isTransientRelativePath("plugins/obsidian-git/obsidian_askpass.sh"), true);
		assert.equal(isTransientRelativePath("debug.log"), true);
		assert.equal(isTransientRelativePath("plugins/smart-composer/data.json"), false);
	});
});

describe("cross-vault Obsidian commands", () => {
	it("allows eval to focus the source vault", () => {
		assert.deepEqual(
			buildOpenVaultBridgeArgs(
				"/tmp/me/project with spaces/ai-artifacts",
				"source-vault-id",
			),
			[
				"vault=source-vault-id",
				"eval",
				"--allow-focus-steal",
				'code=window.electron.ipcRenderer.sendSync(\'vault-open\', "/tmp/me/project with spaces/ai-artifacts", false)',
			],
		);
	});

	it("prefers open vaults before closed fallbacks", () => {
		const registry = {
			vaults: {
				preferredClosed: { path: "/main" },
				otherOpen: { path: "/other", open: true },
			},
		};

		assert.deepEqual(
			listEvalVaultCandidates(registry, ["/main"]),
			["otherOpen", "preferredClosed"],
		);
	});

	it("recognizes Obsidian's temporary command-loading error", () => {
		assert.equal(
			isCommandStillLoading(
				{
					stdout: "",
					stderr: "",
					ok: false,
					error: 'Error: Command "eval" not found. It may require a plugin to be enabled.',
				},
				"eval",
			),
			true,
		);
	});

	it("allows plugin commands to focus their target vault", () => {
		assert.deepEqual(
			buildPluginCommandArgs(
				"artifact-vault-id",
				"plugin:enable",
				"vault-nickname",
			),
			[
				"vault=artifact-vault-id",
				"plugin:enable",
				"--allow-focus-steal",
				"id=vault-nickname",
			],
		);
	});
});

describe("vault nicknames", () => {
	it("derives a readable artifact vault name", () => {
		assert.equal(
			artifactVaultNickname("dot-files"),
			"dot-files · AI Artifacts",
		);
	});

	it("writes the nickname file expected by Vault Nickname", async () => {
		const root = await mkdtemp(join(tmpdir(), "artifact-explorer-"));
		try {
			await writeVaultNickname(root, "dot-files · AI Artifacts");
			const data = JSON.parse(
				await readFile(
					join(
						root,
						"plugins",
						"vault-nickname",
						"data-shared.json",
					),
					"utf8",
				),
			);
			assert.deepEqual(data, { nickname: "dot-files · AI Artifacts" });
			const enabledPlugins = JSON.parse(
				await readFile(join(root, "community-plugins.json"), "utf8"),
			);
			assert.deepEqual(enabledPlugins, ["vault-nickname"]);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
