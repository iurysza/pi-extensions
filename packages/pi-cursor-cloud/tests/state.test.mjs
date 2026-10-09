import test from 'node:test';
import assert from 'node:assert/strict';
import { reduce, visibleAgents, isActive, shortId } from '../src/state.js';

export const agent = (id = 'bc-12345678-abcd') => ({ id, name: 'docs', description: 'Review docs', repo: 'https://github.com/owner/repo', ref: 'main', model: 'composer-2-5', startedAt: 1000, status: { type: 'starting' }, activity: 'starting…', text: '', tools: 0, toolCallIds: [] });
const outcome = { text: 'Done', durationMs: 28000, branches: [] };

test('spawn and stream transitions preserve old state and count tool IDs once', () => {
  const original = reduce([], { type: 'spawned', agent: agent() });
  let state = reduce(original, { type: 'running', id: original[0].id, runId: 'run-1' });
  const activity = { type: 'tool', callId: 'call-1', activity: 'run_terminal_cmd: ls docs' };
  state = reduce(state, { type: 'delta', id: original[0].id, activity });
  state = reduce(state, { type: 'delta', id: original[0].id, activity });
  assert.equal(state[0].tools, 1);
  assert.equal(state[0].activity, 'run_terminal_cmd: ls docs');
  assert.equal(original[0].status.type, 'starting');
  assert.equal(original[0].tools, 0);
  assert.equal(reduce(state, { type: 'spawned', agent: agent() }), state);
});

test('text delta and completed step do not duplicate the response', () => {
  let state = [agent()];
  for (const text of ['Hello ', 'world']) state = reduce(state, { type: 'delta', id: state[0].id, activity: { type: 'text', text } });
  state = reduce(state, { type: 'step', id: state[0].id, activity: { type: 'text', text: 'Hello world', replace: true } });
  assert.equal(state[0].text, 'Hello world');
});

test('terminal outcomes ignore late callbacks and reopen only through followUp', () => {
  for (const type of ['finished', 'cancelled', 'error']) {
    let state = [agent()];
    state = reduce(state, { type, id: state[0].id, result: outcome, error: 'Oops', now: 29000 });
    assert.equal(isActive(state[0]), false);
    assert.deepEqual(visibleAgents(state, 88999), state);
    assert.deepEqual(visibleAgents(state, 89000), []);
    const late = reduce(state, { type: 'delta', id: state[0].id, activity: { type: 'thinking' } });
    assert.deepEqual(late, state);
    assert.deepEqual(reduce(state, { type: 'finished', id: state[0].id, result: { ...outcome, text: 'Late' }, now: 90000 }), state);
    state = reduce(state, { type: 'followUp', id: state[0].id, prompt: 'Next', now: 90000 });
    assert.equal(state[0].status.type, 'starting');
    assert.equal(state[0].startedAt, 90000);
    assert.equal(state[0].tools, 0);
    assert.equal(state[0].text, '');
    assert.equal(state[0].description, 'Next');
  }
});

test('active followUp is rejected and removing an agent is explicit', () => {
  const state = [agent()];
  assert.deepEqual(reduce(state, { type: 'followUp', id: state[0].id, prompt: 'Next', now: 2 }), state);
  assert.deepEqual(reduce(state, { type: 'removed', id: state[0].id }), []);
  assert.equal(shortId(state[0].id), '12345678');
});
