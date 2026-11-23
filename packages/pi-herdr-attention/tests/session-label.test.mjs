import test from "node:test";
import assert from "node:assert/strict";
import { sessionLabelArgs } from "../src/session-label.ts";

test("file goes to pi.session.file, name to pi.session", () => {
	assert.deepEqual(sessionLabelArgs("t7", { file: "/s/a.jsonl", name: " Fix login " }), [
		"label",
		"t7",
		"pi.session.file=/s/a.jsonl",
		"pi.session=Fix login",
	]);
});
test("a session file never becomes pi.session", () => {
	assert.deepEqual(sessionLabelArgs("t7", { file: "/s/a.jsonl", name: undefined }), [
		"label",
		"t7",
		"pi.session.file=/s/a.jsonl",
		"pi.session=",
	]);
});
test("name change leaves the file label alone", () => {
	assert.deepEqual(sessionLabelArgs("t7", { name: "Renamed" }), ["label", "t7", "pi.session=Renamed"]);
});
test("quit clears both", () => {
	assert.deepEqual(sessionLabelArgs("t7", { file: undefined, name: undefined }), [
		"label",
		"t7",
		"pi.session.file=",
		"pi.session=",
	]);
});
test("no terminal id: nothing to do", () => {
	assert.equal(sessionLabelArgs(undefined, { file: "/s/a.jsonl" }), undefined);
});
