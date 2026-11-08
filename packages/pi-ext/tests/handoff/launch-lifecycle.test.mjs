import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { discoverAndLoadExtensions } from '@earendil-works/pi-coding-agent';
import { fixture } from '../../../herdr-ui/tests/fixtures.mjs';

async function withEnvironment(env, action) {
  const saved = { ...process.env };
  for (const key of Object.keys(process.env)) if (!(key in env) || env[key] === undefined) delete process.env[key];
  for (const [key, value] of Object.entries(env)) if (value !== undefined) process.env[key] = value;
  try { return await action(); }
  finally { for (const key of Object.keys(process.env)) delete process.env[key]; Object.assign(process.env, saved); }
}
async function extension(t, name, config, env) {
  const f = fixture(t, config, env);
  const loaded = await discoverAndLoadExtensions([resolve(import.meta.dirname, `../../extensions/${name}/index.ts`)], resolve(import.meta.dirname, '../..'), join(f.root, 'agent'));
  assert.deepEqual(loaded.errors, []);
  return { ...f, ext: loaded.extensions[0] };
}
function context(root, branch = []) {
  const notes = [];
  return {
    cwd: root, hasUI: true, isIdle: () => true,
    sessionManager: {
      getBranch: () => branch, getSessionFile: () => undefined,
      getSessionId: () => 'test-session', getHeader: () => undefined,
    },
    ui: { notify: (message, level) => notes.push({ message, level }) }, notes,
  };
}

test('split-fork passes complete argv and context cwd in a single explicit app launch', async t => {
  const f = await extension(t, 'split-fork', {}, { HC_TERMINAL_ID: 't1' });
  const ctx = context(f.root);
  await withEnvironment(f.env, () => f.ext.commands.get('split-fork').handler('--tab hello $HOME', ctx));
  const call = f.calls().find(x => x.args[0] === 'do');
  assert.equal(call.args[1], 'tab.new');
  const request = JSON.parse(call.args[2]);
  assert.equal(request.folder, f.root);
  assert.deepEqual(request.argv.slice(-2), ['--', 'hello $HOME']);
  assert.equal(f.calls().some(x => ['send', 'send-keys'].includes(x.args[0])), false);
});

test('split-fork failed legacy submission closes its new pane and reports error', async t => {
  const f = await extension(t, 'split-fork', { fail: 'herdr pane run' }, { HERDR_ENV: '1', HERDR_PANE_ID: 'w1:p1' });
  const ctx = context(f.root);
  await withEnvironment(f.env, () => f.ext.commands.get('split-fork').handler('continue', ctx));
  assert.deepEqual(f.calls().at(-1).args, ['pane', 'close', 'w1:p2']);
  assert.equal(ctx.notes.at(-1).level, 'error');
});

test('empty handoff creates no pane and runs no multiplexer commands', async t => {
  const f = await extension(t, 'handoff', {}, { HC_TERMINAL_ID: 't1' });
  const ctx = context(f.root);
  const tool = f.ext.tools.get('handoff').definition;
  const result = await withEnvironment(f.env, () => tool.execute('test', {}, undefined, undefined, ctx));
  assert.match(result.content[0].text, /No conversation to hand off/);
  assert.deepEqual(f.calls(), []);
});

test('handoff history failure creates no pane before prompt construction completes', async t => {
  const f = await extension(t, 'handoff', {}, { HC_TERMINAL_ID: 't1', PI_TASKS: 'off' });
  const ctx = context(f.root);
  ctx.sessionManager.getBranch = () => { throw new Error('unreadable history'); };
  const tool = f.ext.tools.get('handoff').definition;
  await assert.rejects(withEnvironment(f.env, () => tool.execute('test', { goal: 'Continue testing' }, undefined, undefined, ctx)), /unreadable history/);
  assert.deepEqual(f.calls(), []);
});
