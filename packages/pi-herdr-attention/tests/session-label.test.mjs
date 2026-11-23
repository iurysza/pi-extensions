import test from "node:test";
import assert from "node:assert/strict";
import { sessionLabelArgs } from "../src/session-label.ts";

test("builds hc label args", () => {
	assert.deepEqual(sessionLabelArgs("t7", "/s/a.jsonl"), ["label", "t7", "pi.session=/s/a.jsonl"]);
});
test("empty value removes the label", () => {
	assert.deepEqual(sessionLabelArgs("t7", undefined), ["label", "t7", "pi.session="]);
});
test("no terminal id: nothing to do", () => {
	assert.equal(sessionLabelArgs(undefined, "/s/a.jsonl"), undefined);
});
