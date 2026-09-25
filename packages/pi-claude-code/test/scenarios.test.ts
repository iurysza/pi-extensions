import { describe, it } from "vitest";
import { testRuntime } from "./helpers.js";
import { runScenario, scenarios, type Lane } from "./scenarios.js";

const fakeLane: Lane = (upstream, scenario) => testRuntime({ upstream: upstream.url, scenario: scenario.fake ?? {} });

describe("shared scenarios on the fake CLI", () => {
	for (const scenario of scenarios) it(scenario.name, () => runScenario(fakeLane, scenario));
});
