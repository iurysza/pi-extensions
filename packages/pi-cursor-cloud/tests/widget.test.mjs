import test from 'node:test';
import assert from 'node:assert/strict';
import { createWidget } from '../src/widget.js';

const agent = { id: 'bc-12345678', name: 'docs', description: 'Review', repo: 'repo', ref: 'main', model: 'model', startedAt: 0, status: { type: 'running', runId: 'run' }, activity: 'thinking…', text: '', tools: 0, toolCallIds: [] };
const theme = { fg: (_color, text) => text, bold: text => text };

test('widget animates only active work, hides after linger, and cleans up on shutdown', t => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  let state = [agent], now = 1000, component, renders = 0;
  const widgets = [], statuses = [];
  const ui = {
    setWidget(key, factory, options) {
      widgets.push({ key, factory, options });
      component = factory?.({ requestRender: () => renders++ }, theme);
    },
    setStatus: (key, text) => statuses.push({ key, text }),
  };
  const widget = createWidget(() => state, () => now);
  t.after(() => widget.dispose());
  widget.attach({ mode: 'tui', ui });
  assert.equal(widgets.length, 1);
  assert.match(component.render(100)[1], /⠋/);
  t.mock.timers.tick(150);
  assert.match(component.render(100)[1], /⠙/);
  assert.equal(renders, 1);
  state = [{ ...agent, status: { type: 'idle', endedAt: now, result: { text: 'Done', durationMs: 1000, branches: [] } } }];
  widget.update();
  const finishedRenders = renders;
  t.mock.timers.tick(1000);
  assert.equal(renders, finishedRenders, 'idle animation is stopped');
  assert.equal(statuses.at(-1).text, undefined);
  now = 61000;
  t.mock.timers.tick(60000);
  assert.equal(widgets.at(-1).factory, undefined, 'linger expiry unregisters the widget');
  assert.equal(state.length, 1, 'history survives expiry');
  state = [agent];
  widget.update();
  widget.dispose();
  const disposedRenders = renders;
  t.mock.timers.tick(60000);
  assert.equal(renders, disposedRenders, 'disposed timers do not render');
});

test('JSON and RPC modes never install terminal widget factories', () => {
  const widget = createWidget(() => [agent], () => 0);
  const ctx = { mode: 'rpc', ui: { setWidget() { assert.fail('terminal widget in RPC'); } } };
  widget.attach(ctx);
  widget.update();
  widget.dispose();
});
