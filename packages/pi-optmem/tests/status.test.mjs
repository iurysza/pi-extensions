import assert from "node:assert/strict";
import test from "node:test";
import { ICON as I, jobStatus, statusText } from "../src/status.js";

test("footer: modes, missing memo, and off shows nothing", () => {
  assert.equal(statusText("off", false, undefined), undefined);
  assert.equal(statusText("off", true, `${I.sync} 1/2`), undefined);
  assert.equal(statusText("on", false, undefined), I.brain);
  assert.equal(statusText("read", false, undefined), `${I.brain} ${I.eye}`);
  assert.equal(statusText("on", true, undefined), `${I.brain} ${I.alert} no memo`);
  assert.equal(statusText("on", false, `${I.check} review`), `${I.brain} ${I.check} review`);
});

test("footer: job phases", () => {
  const job = (o) => ({ kind: "generate", processed: 120, total: 1957, napsDone: 12, napsPending: 28, ...o });
  assert.equal(jobStatus(undefined, false), undefined);
  assert.equal(jobStatus(job({ phase: "distil" }), true), `${I.sync} 120/1957`);
  assert.equal(jobStatus(job({ phase: "distil", kind: "catchup", processed: 3, total: 10 }), true), `${I.sync} catchup 3/10`);
  assert.equal(jobStatus(job({ phase: "distil" }), false), undefined, "stale job shows nothing");
  assert.equal(jobStatus(job({ phase: "awaiting-confirm" }), false), `${I.check} review`);
  assert.equal(jobStatus(job({ phase: "importing" }), true), `${I.download} import`);
  assert.equal(jobStatus(job({ phase: "naps" }), true), `${I.sleep} 12/40`);
  assert.equal(jobStatus(job({ phase: "failed" }), false), `${I.alert} failed`);
  assert.equal(jobStatus(job({ phase: "done" }), false), undefined);
});
