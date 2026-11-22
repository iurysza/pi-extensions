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
test('app viewer floats via hc run and terminal.peek without status or overlay close', t => {
  const f = fixture(t, {}, { HC_TERMINAL_ID: 't1', HERDR_ENV: '1', HERDR_PANE_ID: 'w1:p1' });
  const r = f.ui.openViewer({ ...launch, name: 'Skill: x', legacy: { plugin: 'viewer', entrypoint: 'file', root: '/plugin' } });
  assert.equal(r.ok, true);
  assert.deepEqual([r.value.backend, r.value.placement, r.value.id, r.value.terminal], ['app', 'float', 't5', 't5']);
  const [ls, run, peek] = f.calls();
  assert.deepEqual([ls.command, ls.args[0]], ['herdr-app', 'ls']);
  assert.equal(run.command, 'hc');
  assert.deepEqual(run.args.slice(0, 7), ['run', '--bg', '--json', '--no-notify', '--rm', '--cwd', launch.cwd]);
  assert.match(run.args[8], /^skill-x-[0-9a-f]{4}$/);
  assert.deepEqual(run.args.slice(9), ['--', ...launch.argv]);
  assert.deepEqual(peek.args, ['do', 'terminal.peek', '--terminal', 't5']);
  assert.equal(f.calls().some(x => x.args[0] === 'status' || x.args[1] === 'overlay.close'), false);
  assert.equal(f.ui.close(r.value).ok, true);
  assert.deepEqual(f.calls().slice(-2).map(x => [x.command, x.args]), [['hc', ['kill', 't5']], ['hc', ['rm', 't5']]]);
});
test('app float retries only the listing race, then succeeds', t => {
  const f = fixture(t, { peekRace: 2 }, { HC_TERMINAL_ID: 't1' });
  const r = f.ui.float({ cwd: '/tmp', argv: ['htop'] });
  assert.equal(r.ok, true);
  assert.equal(f.calls().filter(x => x.args[1] === 'terminal.peek').length, 3);
  assert.equal(f.calls().some(x => x.args.includes('--name')), false);
});
test('app float peek failure or timeout closes its terminal', t => {
  for (const config of [{ peekError: 'boom' }, { peekRace: 1000 }]) {
    const f = fixture(t, config, { HC_TERMINAL_ID: 't1' });
    const r = f.ui.float({ cwd: '/tmp', argv: ['htop'] });
    assert.equal(r.error.code, 'float_failed');
    assert.deepEqual(f.calls().slice(-2).map(x => x.args), [['kill', 't5'], ['rm', 't5']]);
  }
  const caller = fixture(t, { hcRun: { address: 't1' } }, { HC_TERMINAL_ID: 't1' });
  assert.equal(caller.ui.float({ cwd: '/tmp', argv: ['htop'] }).error.code, 'invalid_response');
  assert.equal(caller.calls().some(x => x.args[0] === 'kill' || x.args[0] === 'rm'), false);
});
test('closing an app float that already exited and was removed succeeds once', t => {
  const f = fixture(t, {}, { HC_TERMINAL_ID: 't1' });
  const r = f.ui.float({ cwd: '/tmp', argv: ['htop'] });
  // A second fixture whose hc reports not_found models the program having ended (--rm).
  const gone = fixture(t, { hcGone: true });
  const ui = createHerdrUi({ env: gone.env });
  assert.equal(ui.close(r.value).ok, true);
  assert.equal(ui.close(r.value).error.code, 'not_owned');
});
test('app viewer falls back to a tab and keeps the float error visible', t => {
  const f = fixture(t, { peekError: 'boom' }, { HC_TERMINAL_ID: 't1' });
  const r = f.ui.openViewer({ ...launch, name: 'Skill: x' });
  assert.equal(r.ok, true);
  assert.equal(r.value.placement, 'tab');
  assert.equal(r.warning.code, 'float_failed');
  assert.deepEqual(JSON.parse(f.calls().find(x => x.args[1] === 'tab.new').args[2]), { name: 'Skill: x', space: 'sp1', folder: launch.cwd, argv: launch.argv });
  const both = fixture(t, { peekError: 'boom', fail: 'herdr-app do' }, { HC_TERMINAL_ID: 't1' });
  const failed = both.ui.openViewer(launch);
  assert.equal(failed.ok, false);
  assert.match(failed.error.message, /Float failed \(float_failed.*tab fallback failed/);
});
test('app viewer surfaces stale mapping without fallback', t => {
  const stale = fixture(t, { listing: { spaces: [] } }, { HC_TERMINAL_ID: 't1', HERDR_ENV: '1', TMUX: 'outer' });
  assert.equal(stale.ui.openViewer(launch).ok, false);
  assert.deepEqual(stale.calls().map(x => x.command), ['herdr-app']);
});
test('rex is detected after Herdr and before tmux, and floats a centred owned layer', t => {
  const f = fixture(t, {}, { REX_SESSION: 'session:s1', REX_BLOCK: 'block:me', TMUX: 'outer', REX_BIN: undefined });
  assert.deepEqual(f.ui.resolveCaller().value, { backend: 'rex', session: 'session:s1', block: 'block:me' });
  assert.equal(fixture(t, {}, { HC_TERMINAL_ID: 't1', REX_SESSION: 's', REX_BLOCK: 'b' }).ui.resolveCaller().value.backend, 'app');
  assert.equal(fixture(t, {}, { REX_SESSION: 's', REX_BLOCK: '', TMUX: 'outer' }).ui.resolveCaller().value.backend, 'tmux');
  const r = f.ui.float({ cwd: launch.cwd, argv: launch.argv, name: 'Viewer', width: 0.6, height: 0.5 });
  assert.equal(r.ok, true);
  assert.deepEqual([r.value.backend, r.value.placement, r.value.id, r.value.session], ['rex', 'float', 'layer:0abc', 'session:s1']);
  const open = f.calls().find(x => x.args[4] === 'session.new_layer');
  assert.deepEqual(open.args, ['api', 'call', '-s', 'session:s1', 'session.new_layer', '-']);
  assert.deepEqual(open.input, { bounds: [0.2, 0.25, 0.6, 0.5], focus: true, window_id: 'window:w1', layout: { block: { flavor: 'com.superlogical.terminal.shell', label: 'Viewer', options: { shell: 'none', command: launch.argv, cwd: launch.cwd } } } });
  assert.equal(f.ui.close(r.value).ok, true);
  const closed = f.calls().at(-1);
  assert.deepEqual([closed.args[4], closed.input], ['session.close_layer', { layer_id: 'layer:0abc' }]);
  assert.equal(f.ui.close(r.value).error.code, 'not_owned');
});
test('rex float omits window_id when the caller block is not found, and close tolerates an exited layer', t => {
  const f = fixture(t, { rexView: { windows: [] }, rexGone: true }, { REX_SESSION: 'session:s1', REX_BLOCK: 'block:me' });
  const r = f.ui.float({ cwd: '/tmp', argv: ['htop'] });
  assert.equal(r.ok, true);
  assert.deepEqual(f.calls().find(x => x.args[4] === 'session.new_layer').input.bounds.map(x => +x.toFixed(2)), [0.1, 0.1, 0.8, 0.8]);
  assert.equal('window_id' in f.calls().find(x => x.args[4] === 'session.new_layer').input, false);
  assert.equal(f.ui.close(r.value).ok, true);
  assert.equal(fixture(t, { rexLayer: { layer_id: null } }, { REX_SESSION: 's', REX_BLOCK: 'b' }).ui.float({ cwd: '/tmp', argv: ['x'] }).error.code, 'invalid_response');
  assert.equal(f.ui.launch(launch).error.code, 'unsupported_backend');
});
test('rex binary falls back from REX_BIN to PATH to the app bundle', t => {
  const f = fixture(t, {}, { REX_SESSION: 's', REX_BLOCK: 'b' });
  const viaBin = createHerdrUi({ env: { ...f.env, PATH: '/nonexistent', REX_BIN: `${f.root}/rex` } });
  assert.equal(viaBin.float({ cwd: '/tmp', argv: ['x'] }).ok, true);
  const bundle = createHerdrUi({ env: { ...f.env, PATH: '/nonexistent', HOME: '/nonexistent-home' } });
  assert.equal(bundle.float({ cwd: '/tmp', argv: ['x'] }).error.code, 'command_failed');
});
test('viewer floats for rex, keeps splits for tmux and cmux; float is unsupported elsewhere', t => {
  const rex = fixture(t, {}, { REX_SESSION: 's', REX_BLOCK: 'b' });
  assert.equal(rex.ui.openViewer(launch).value.placement, 'float');
  assert.equal(fixture(t, {}, { TMUX: 'outer' }).ui.openViewer(launch).value.placement, 'split');
  for (const context of [{ TMUX: 'outer' }, { CMUX_SOCKET_PATH: 'socket' }, {}, { HERDR_ENV: '1', HERDR_PANE_ID: 'w1:p1' }]) {
    const f = fixture(t, {}, context);
    assert.equal(f.ui.float({ cwd: '/tmp', argv: ['x'] }).error.code, 'float_unsupported');
    assert.equal(f.calls().some(x => x.args[0] !== 'pane'), false);
  }
  const f = fixture(t);
  for (const bad of [{ cwd: 'rel', argv: ['x'] }, { cwd: '/tmp', argv: [] }, { cwd: '/tmp', argv: ['x'], width: 0 }, { cwd: '/tmp', argv: ['x'], height: 1.5 }]) {
    assert.equal(f.ui.float(bad).error.code, 'invalid_request');
  }
});
test('CLI float accepts the same JSON envelope', t => {
  const f = fixture(t, {}, { REX_SESSION: 's', REX_BLOCK: 'b' });
  const r = spawnSync(process.execPath, [cli, 'float'], { env: f.env, input: JSON.stringify({ cwd: '/tmp', argv: ['x'] }), encoding: 'utf8' });
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.version, 1);
  assert.equal(out.value.placement, 'float');
  const closed = spawnSync(process.execPath, [cli, 'close'], { env: f.env, input: JSON.stringify({ target: out.value }), encoding: 'utf8' });
  assert.equal(JSON.parse(closed.stdout).ok, true);
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
test('concurrent app viewer requests each open their own owned tab when floats fail', async t => {
  const f = fixture(t, { peekError: 'boom' }, { HC_TERMINAL_ID: 't1' });
  const run = () => new Promise(resolve => {
    const child = spawn(process.execPath, [cli, 'viewer'], { env: f.env });
    let out = ''; child.stdout.on('data', x => out += x); child.stdin.end(JSON.stringify(launch));
    child.on('close', () => resolve(JSON.parse(out)));
  });
  const responses = await Promise.all([run(), run()]);
  assert.ok(responses.every(r => r.ok && r.value.placement === 'tab'));
  assert.equal(f.calls().filter(x => x.args[1] === 'tab.new').length, 2);
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
