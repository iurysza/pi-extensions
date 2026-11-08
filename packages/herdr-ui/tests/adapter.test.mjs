import assert from 'node:assert/strict';
import { spawnSync, spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { mkdirSync, realpathSync } from 'node:fs';
import { fixture } from './fixtures.mjs';
import test from 'node:test';
import { createHerdrUi } from '../index.mjs';

const cli = resolve(import.meta.dirname, '../cli.mjs');
const launch = { cwd: '/tmp/a dir with "quotes"', argv: ['pi', '--', "it's $HOME\nhello"], placement: 'split' };

test('fresh app wins over inherited legacy and preserves selected app home', t => {
  const f = fixture(t, {}, { HC_TERMINAL_ID: 't1', HERDR_ENV: '1', HERDR_PANE_ID: 'stale', HERDR_APP_HOME: '/tmp/custom app' });
  assert.deepEqual(f.ui.resolveCaller(), { ok: true, value: { backend: 'app', terminal: 't1', pane: 'p1', space: 'sp1', tab: 'tb1', appHome: '/tmp/custom app' } });
  assert.deepEqual(f.calls().map(x => [x.command, x.appHome]), [['herdr-app', '/tmp/custom app']]);
});
for (const [label, listing] of [
  ['missing', { spaces: [] }],
  ['ambiguous', { spaces: [{ id: 'sp1', tabs: [{ id: 'tb1', terminals: [{ terminal: 't1', pane: 'p1' }, { terminal: 't1', pane: 'p2' }] }] }] }],
  ['malformed', '{oops'],
  ['wrong schema', { spaces: [null] }],
]) test(`${label} app mapping never falls through to legacy or focus`, t => {
  const f = fixture(t, { listing }, { HC_TERMINAL_ID: 't1', HERDR_ENV: '1', TMUX: 'outer' });
  const r = f.ui.launch(launch);
  assert.equal(r.ok, false);
  assert.match(r.error.message, /Reopen or restart Pi/);
  assert.deepEqual(f.calls().map(x => x.command), ['herdr-app']);
});
test('invalid or empty app ID fails without commands', t => {
  const f = fixture(t, {}, { HC_TERMINAL_ID: '', HERDR_ENV: '1' });
  assert.equal(f.ui.resolveCaller().error.code, 'stale_context');
  assert.deepEqual(f.calls(), []);
});
test('legacy must verify the exact live caller', t => {
  const f = fixture(t, {}, { HERDR_ENV: '1', HERDR_PANE_ID: 'w1:p1' });
  assert.deepEqual(f.ui.resolveCaller(), { ok: true, value: { backend: 'legacy', pane: 'w1:p1', workspace: 'w1' } });
  const stale = fixture(t, {}, { HERDR_ENV: '1', HERDR_PANE_ID: 'w1:missing', TMUX: 'outer' });
  assert.equal(stale.ui.resolveCaller().error.code, 'stale_context');
});
test('non-Herdr callers retain tmux, cmux and none precedence', t => {
  assert.equal(fixture(t, {}, { TMUX: 'outer', CMUX_SOCKET_PATH: 'socket' }).ui.resolveCaller().value.backend, 'tmux');
  assert.equal(fixture(t, {}, { CMUX_SOCKET_PATH: 'socket' }).ui.resolveCaller().value.backend, 'cmux');
  assert.equal(fixture(t).ui.resolveCaller().value.backend, 'none');
});
test('app split is explicit and shell positional arguments preserve cwd and argv', t => {
  const f = fixture(t, {}, { HC_TERMINAL_ID: 't1' });
  const r = f.ui.launch(launch);
  assert.equal(r.ok, true);
  const call = f.calls().find(x => x.args[0] === 'do');
  assert.equal(call.args[1], 'pane.split');
  assert.deepEqual(JSON.parse(call.args[2]), { pane: 'p1', direction: 'right', argv: ['sh', '-c', 'cd -- "$1" && shift && exec "$@"', 'herdr-ui', launch.cwd, ...launch.argv] });
  assert.equal(r.value.id, 'p2');
  assert.equal(r.value.terminal, 't2');
  assert.equal(f.ui.close(r.value).ok, true);
  assert.deepEqual(f.calls().slice(-2).map(x => [x.command, x.args]), [['hc', ['kill', 't2']], ['hc', ['rm', 't2']]]);
});
test('app tab specifies caller space, folder and argv', t => {
  const f = fixture(t, {}, { HC_TERMINAL_ID: 't1' });
  const r = f.ui.launch({ ...launch, placement: 'tab', name: 'handoff' });
  assert.equal(r.ok, true);
  assert.deepEqual(JSON.parse(f.calls().find(x => x.args[0] === 'do').args[2]), { name: 'handoff', space: 'sp1', folder: launch.cwd, argv: launch.argv });
  assert.equal(f.ui.close(r.value).ok, true);
});
test('send and close use receipt backend even if caller environment changes', t => {
  const f = fixture(t, {}, { TMUX: 'socket' });
  const r = f.ui.launch(launch);
  assert.equal(r.ok, true);
  const ui = createHerdrUi({ env: { ...f.env, HC_TERMINAL_ID: 't99', TMUX: undefined } });
  assert.equal(ui.send(r.value, 'text').ok, true);
  assert.equal(ui.close(r.value).ok, true);
  assert.ok(f.calls().every(x => x.command === 'tmux'));
  assert.equal(ui.close(r.value).error.code, 'not_owned');
});
test('arbitrary or modified target cannot be closed', t => {
  const f = fixture(t, {}, { HC_TERMINAL_ID: 't1' });
  assert.equal(f.ui.close({ backend: 'app', terminal: 't1' }).error.code, 'not_owned');
  const r = f.ui.launch(launch);
  assert.equal(f.ui.close({ ...r.value, terminal: 't1' }).error.code, 'not_owned');
  assert.equal(f.ui.close(r.value).ok, true);
});
test('failed legacy command submission closes only the newly created pane', t => {
  const f = fixture(t, { fail: 'herdr pane run' }, { HERDR_ENV: '1', HERDR_PANE_ID: 'w1:p1' });
  const r = f.ui.launch(launch);
  assert.equal(r.ok, false);
  assert.deepEqual(f.calls().at(-1).args, ['pane', 'close', 'w1:p2']);
});
test('failed cmux command submission closes only the newly created surface', t => {
  const f = fixture(t, { fail: 'cmux send' }, { CMUX_SOCKET_PATH: 'socket' });
  assert.equal(f.ui.launch(launch).ok, false);
  assert.deepEqual(f.calls().at(-1).args, ['close-surface', '--surface', 'surface:8']);
});
test('app viewer opens its own tab in the caller space without status, peek or overlay close', t => {
  const f = fixture(t, { status: { focused_pane: 'p9', agent: 't9', space: 'sp1', tab: 'tb1', overlays: ['layout'] } }, { HC_TERMINAL_ID: 't1', HERDR_ENV: '1', HERDR_PANE_ID: 'w1:p1' });
  const r = f.ui.openViewer({ ...launch, name: 'Skill: x', legacy: { plugin: 'viewer', entrypoint: 'file', root: '/plugin' } });
  assert.equal(r.ok, true);
  assert.equal(r.value.backend, 'app');
  assert.equal(r.value.placement, 'tab');
  assert.equal(r.value.id, 'tb2');
  assert.deepEqual(f.calls().map(x => [x.command, x.args[0], x.args[1]]), [['herdr-app', 'ls', undefined], ['herdr-app', 'do', 'tab.new']]);
  assert.deepEqual(JSON.parse(f.calls()[1].args[2]), { name: 'Skill: x', space: 'sp1', folder: launch.cwd, argv: launch.argv });
  assert.equal(f.ui.close(r.value).ok, true);
});
test('app viewer surfaces stale mapping and launch failures without fallback', t => {
  const stale = fixture(t, { listing: { spaces: [] } }, { HC_TERMINAL_ID: 't1', HERDR_ENV: '1', TMUX: 'outer' });
  assert.equal(stale.ui.openViewer(launch).ok, false);
  assert.deepEqual(stale.calls().map(x => x.command), ['herdr-app']);
  const failed = fixture(t, { fail: 'herdr-app do' }, { HC_TERMINAL_ID: 't1', TMUX: 'outer' });
  const r = failed.ui.openViewer(launch);
  assert.equal(r.ok, false);
  assert.ok(failed.calls().every(x => x.command === 'herdr-app'));
});
test('legacy plugin links only a specific missing-plugin failure', t => {
  const request = { ...launch, legacy: { plugin: 'viewer', entrypoint: 'file', root: '/plugin', env: { FILE: 'file.md' } } };
  const f = fixture(t, { pluginMissing: true }, { HERDR_ENV: '1', HERDR_PANE_ID: 'w1:p1' });
  const r = f.ui.openViewer(request);
  assert.equal(r.ok, true);
  assert.equal(f.calls().filter(x => x.args[1] === 'link').length, 1);
  assert.equal(f.ui.close(r.value).ok, true);
  const busy = fixture(t, { pluginBusy: true }, { HERDR_ENV: '1', HERDR_PANE_ID: 'w1:p1' });
  assert.equal(busy.ui.openViewer(request).error.code, 'viewer_failed');
  assert.equal(busy.calls().some(x => x.args[1] === 'link'), false);
});
test('CLI emits versioned JSON for resolve and rejects malformed input', t => {
  const f = fixture(t);
  const r = spawnSync(process.execPath, [cli, 'resolve'], { env: f.env, encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.deepEqual(JSON.parse(r.stdout), { version: 1, ok: true, value: { backend: 'none' } });
  const bad = spawnSync(process.execPath, [cli, 'launch'], { env: f.env, input: '{bad', encoding: 'utf8' });
  assert.equal(bad.status, 2);
  assert.equal(JSON.parse(bad.stdout).error.code, 'invalid_request');
});
test('concurrent app viewer requests each open their own owned tab', async t => {
  const f = fixture(t, {}, { HC_TERMINAL_ID: 't1' });
  const run = () => new Promise(resolve => {
    const child = spawn(process.execPath, [cli, 'viewer'], { env: f.env });
    let out = ''; child.stdout.on('data', x => out += x); child.stdin.end(JSON.stringify(launch));
    child.on('close', () => resolve(JSON.parse(out)));
  });
  const responses = await Promise.all([run(), run()]);
  assert.ok(responses.every(r => r.ok && r.value.placement === 'tab'));
  assert.ok(f.calls().every(x => x.args[0] === 'ls' || (x.args[0] === 'do' && x.args[1] === 'tab.new')));
});

test('split cwd wrapper executes literal argv without expanding shell content', t => {
  const f = fixture(t, {}, { HC_TERMINAL_ID: 't1' });
  const cwd = join(f.root, "space and ' quote");
  mkdirSync(cwd);
  const argv = [process.execPath, '-e', 'console.log(JSON.stringify({cwd:process.cwd(),args:process.argv.slice(1)}))', '--', '$HOME', "a'b", 'two\nlines', '$(touch nope)'];
  const result = f.ui.launch({ cwd, argv, placement: 'split' });
  assert.equal(result.ok, true);
  const request = JSON.parse(f.calls().find(x => x.args[0] === 'do').args[2]);
  const actual = spawnSync('/bin/sh', request.argv.slice(1), { encoding: 'utf8' });
  assert.equal(actual.status, 0);
  assert.deepEqual(JSON.parse(actual.stdout), { cwd: realpathSync(cwd), args: ['$HOME', "a'b", 'two\nlines', '$(touch nope)'] });
  assert.equal(f.ui.close(result.value).ok, true);
});

test('versioned CLI target can be closed in a different process', t => {
  const f = fixture(t, {}, { HC_TERMINAL_ID: 't1' });
  const created = spawnSync(process.execPath, [cli, 'launch'], { env: f.env, input: JSON.stringify(launch), encoding: 'utf8' });
  assert.equal(created.status, 0);
  const target = JSON.parse(created.stdout).value;
  const closed = spawnSync(process.execPath, [cli, 'close'], { env: { ...f.env, HC_TERMINAL_ID: 't99' }, input: JSON.stringify({ target }), encoding: 'utf8' });
  assert.deepEqual(JSON.parse(closed.stdout), { version: 1, ok: true, value: null });
  assert.deepEqual(f.calls().slice(-2).map(x => x.args), [['kill', 't2'], ['rm', 't2']]);
});

test('malformed app launch response cleans only a distinct returned terminal', t => {
  const f = fixture(t, { created: { pane: null, terminal: 't2' } }, { HC_TERMINAL_ID: 't1' });
  assert.equal(f.ui.launch(launch).error.code, 'invalid_response');
  assert.deepEqual(f.calls().slice(-2).map(x => x.args), [['kill', 't2'], ['rm', 't2']]);
  const invalid = fixture(t, { created: { pane: 'p2', terminal: 't1' } }, { HC_TERMINAL_ID: 't1' });
  assert.equal(invalid.ui.launch(launch).error.code, 'invalid_response');
  assert.equal(invalid.calls().some(x => x.command === 'hc'), false);
});

test('cmux tab keeps its requested name and explicit cwd', t => {
  const f = fixture(t, {}, { CMUX_SOCKET_PATH: 'socket' });
  const r = f.ui.launch({ ...launch, placement: 'tab', name: 'handoff' });
  assert.equal(r.ok, true);
  assert.deepEqual(f.calls().find(x => x.args[0] === 'rename-tab').args, ['rename-tab', '--surface', 'surface:8', 'handoff']);
  assert.match(f.calls().find(x => x.args[0] === 'send').args[3], /^cd '/);
  assert.equal(f.ui.close(Object.fromEntries(Object.entries(r.value).reverse())).ok, true);
});

test('real core terminal suffixes are base36, not hexadecimal', t => {
  const f = fixture(t, { listing: { spaces: [{ id: 'sp1', tabs: [{ id: 'tb1', terminals: [{ terminal: 't3z', pane: 'p1' }] }] }] } }, { HC_TERMINAL_ID: 't3z' });
  const r = f.ui.resolveCaller();
  assert.equal(r.ok, true);
  assert.equal(r.value.terminal, 't3z');
});
