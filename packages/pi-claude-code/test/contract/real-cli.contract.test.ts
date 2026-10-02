import { resolve } from "node:path";
import { describe, it } from "vitest";
import { testRuntime } from "../helpers.js";
import { runScenario, scenarios, type Lane } from "../scenarios.js";

const cli = process.env.PI_CLAUDE_CODE_CONTRACT_CLI;

/** Accepted by the real CLI as a login; only the fake upstream ever sees it. */
const CONTRACT_TOKEN = "sk-ant-oat01-contract";

const realLane: Lane = (upstream, scenario) =>
	testRuntime({
		upstream: upstream.url,
		command: resolve(cli!),
		idleTimeoutMs: 60_000,
		env: { CLAUDE_CODE_OAUTH_TOKEN: scenario.loggedOut ? undefined : CONTRACT_TOKEN },
	});

describe.skipIf(!cli)("shared scenarios on the real Claude Code CLI", () => {
	for (const scenario of scenarios) it(scenario.name, () => runScenario(realLane, scenario), 60_000);
});
