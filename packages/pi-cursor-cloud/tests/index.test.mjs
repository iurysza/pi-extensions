import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Text } from '@earendil-works/pi-tui';
import { registerCloudExtension } from '../src/index.js';

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = () => new Promise(resolve => setImmediate(resolve));
const outcome = (type = 'finished') => ({ type, result: { text: 'Docs checked.', durationMs: 28000, branches: [{ repoUrl: 'repo', branch: 'cursor/docs', prUrl: 'https://github.com/a/b/pull/1' }] } });

function harness(t, { mode = 'tui', pendingSend = false, createGate, deleteGate, inputs = [], picks = [], commandNames = [], models = [], modelsError = false, savedModel } = {}) {
  const busListeners = new Map(), asked = [];
  const root = mkdtempSync(join(tmpdir(), 'cloud-test-'));
  const configPath = join(root, 'pi-cursor-cloud.json');
  if (savedModel) writeFileSync(configPath, JSON.stringify({ defaultModel: savedModel }));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const tools = new Map(), commands = new Map(), events = new Map(), renderers = new Map();
  const messages = [], notices = [], widgets = [], statuses = [], handles = [], deleted = [], opened = [];
  let renders = 0;
  const pi = {
    registerTool: tool => tools.set(tool.name, tool),
    registerCommand: (name, command) => commands.set(name, command),
    registerMessageRenderer: (name, renderer) => renderers.set(name, renderer),
    on: (name, callback) => events.set(name, callback),
    sendMessage: (message, options) => messages.push({ ...message, options }),
    events: { on: (name, fn) => busListeners.set(name, fn), emit: (name, data) => busListeners.get(name)?.(data) },
    exec: async (command, args) => { opened.push({ command, args }); return { code: 0, stdout: '', stderr: '' }; },
    getCommands: () => commandNames.map(name => ({ name, source: 'extension' })),
  };
  const theme = { fg: (_c, s) => s, bold: s => s };
  let component;
  const ctx = { cwd: '/test/repo', mode, hasUI: mode === 'tui', ui: {
    setWidget: (name, factory, options) => { widgets.push({ name, factory, options }); component = factory?.({ requestRender: () => renders++ }, theme); },
    setStatus: (name, text) => statuses.push({ name, text }),
    notify: (text, level) => notices.push({ text, level }),
    input: async title => { asked.push(title); return inputs.shift(); },
    select: async (title, options) => { asked.push({ title, options }); const i = picks.shift(); return i === undefined ? undefined : options[i]; },
  } };
  const client = {
    async models() { if (modelsError) throw new Error('Model listing failed'); return models; },
    async create(options) {
      if (createGate) await createGate.promise;
      const handle = { id: `bc-${String(handles.length + 1).padStart(8, '0')}-uuid`, options, runs: [], closed: false,
        close() { this.closed = true; },
        async send(prompt, emit) {
          const done = deferred(), ready = deferred();
          const run = { id: `run-${this.runs.length}`, prompt, emit, done, ready, cancelled: false,
            wait: () => done.promise,
            async cancel() { this.cancelled = true; done.resolve(outcome('cancelled')); },
          };
          this.runs.push(run);
          if (pendingSend) await ready.promise;
          return run;
        },
      };
      handles.push(handle);
      return handle;
    },
    async delete(id) { deleted.push(id); if (deleteGate) await deleteGate.promise; },
  };
  registerCloudExtension(pi, { client, configPath, now: () => 29000, repo: async (_cwd, repo, ref) => ({ repo: repo ?? 'https://github.com/a/b', ref: ref ?? 'main' }) });
  events.get('session_start')({}, ctx);
  t.after(() => events.get('session_shutdown')({}, ctx));
  const execute = (name, params) => tools.get(name).execute('call-id', params, undefined, undefined, ctx);
  const status = async id => JSON.parse((await execute('cursor_cloud_status', { id })).content[0].text);
  return { execute, status, opened, configPath, handles, busListeners, asked, messages, notices, widgets, statuses, deleted, commands, events, ctx, renderers,
    lines: width => component?.render(width) ?? [], renderCount: () => renders };
}

test('spawn returns before SDK send or wait, reserves busy state, and delivers completion later', async t => {
  const h = harness(t, { pendingSend: true });
  const result = await h.execute('cursor_cloud_spawn', { prompt: 'Review docs', name: 'docs' });
  assert.match(result.content[0].text, /00000001.*background/);
  assert.equal(h.messages.length, 0);
  const handle = h.handles[0], run = handle.runs[0];
  assert.equal((await h.status('00000001'))[0].status, 'starting');
  await assert.rejects(h.execute('cursor_cloud_send', { id: '00000001', prompt: 'Early' }), /active run/);
  run.ready.resolve();
  await flush();
  run.emit({ type: 'delta', activity: { type: 'tool', callId: 'call', activity: 'run_terminal_cmd: ls docs' } });
  assert.ok(h.lines(150).join('\n').includes('run_terminal_cmd: ls docs'));
  assert.deepEqual(h.widgets.find(w => w.factory).options, { placement: 'aboveEditor' });
  run.done.resolve(outcome());
  await flush();
  assert.equal((await h.status('00000001'))[0].status, 'idle');
  const message = h.messages[0];
  assert.equal(message.customType, 'cursor-cloud-completion');
  assert.deepEqual(message.options, { deliverAs: 'followUp', triggerTurn: true });
  assert.match(message.content, /Docs checked/);
  assert.match(message.content, /PR:/);
  assert.ok(h.lines(150).join('\n').includes('✓'));
  assert.equal(h.statuses.at(-1).text, undefined);
  assert.ok(h.renderers.has('cursor-cloud-completion'));
});

test('idle follow-up resets activity and is reserved before another send can race', async t => {
  const h = harness(t);
  await h.execute('cursor_cloud_spawn', { prompt: 'First' });
  h.handles[0].runs[0].done.resolve(outcome());
  await flush();
  await h.execute('cursor_cloud_send', { id: 'bc-00000001', prompt: 'Next' });
  await assert.rejects(h.execute('cursor_cloud_send', { id: '00000001', prompt: 'Race' }), /active run/);
  await flush();
  assert.equal(h.handles[0].runs[1].prompt, 'Next');
  assert.equal((await h.status('00000001'))[0].tools, 0);
  h.handles[0].runs[1].done.resolve(outcome());
  await flush();
  assert.equal(h.messages.length, 2);
  assert.equal(h.messages[0].details.prompt, 'First');
  assert.equal(h.messages[1].details.prompt, 'Next');
  assert.notEqual(h.messages[0].details.completionId, h.messages[1].details.completionId);
});

test('cancel reports terminal result and commands restrict deletion to owned idle agents', async t => {
  const h = harness(t);
  await h.execute('cursor_cloud_spawn', { prompt: 'Task' });
  await flush();
  await h.commands.get('cloud').handler('delete 00000001', h.ctx);
  assert.match(h.notices.at(-1).text, /Cancel the active run/);
  await h.execute('cursor_cloud_cancel', { id: '00000001' });
  await flush();
  assert.equal(h.handles[0].runs[0].cancelled, true);
  assert.equal((await h.status('00000001'))[0].status, 'cancelled');
  assert.match(h.messages[0].content, /cancelled/);
  await h.commands.get('cloud').handler('delete bc-someone-else', h.ctx);
  assert.equal(h.deleted.length, 0);
  await h.commands.get('cloud').handler('delete 00000001', h.ctx);
  assert.deepEqual(h.deleted, ['bc-00000001-uuid']);
  assert.equal(h.handles[0].closed, true);
  assert.deepEqual(await h.status(), []);
});

test('command spawn preserves multiline prompt and command send does not live-steer', async t => {
  const h = harness(t);
  await h.commands.get('cloud').handler('spawn First line\nSecond line', h.ctx);
  assert.equal(h.handles[0].runs[0].prompt, 'First line\nSecond line');
  await h.commands.get('cloud').handler('send 00000001 Next', h.ctx);
  assert.match(h.notices.at(-1).text, /active run/);
  await h.commands.get('cloud').handler('', h.ctx);
  assert.match(h.messages.at(-1).content, /ID\s+NAME/);
});

test('command spawn accepts repo, ref, model and name flags before the prompt', async t => {
  const h = harness(t);
  await h.commands.get('cloud').handler('spawn --repo https://github.com/x/y --ref dev --model m1 --name docs Read --repo literally', h.ctx);
  assert.deepEqual(h.handles[0].options, { repo: 'https://github.com/x/y', ref: 'dev', model: 'm1', name: 'docs' });
  assert.equal(h.handles[0].runs[0].prompt, 'Read --repo literally');
});

test('failure emits a terminal message and non-interactive tools still work', async t => {
  const h = harness(t, { mode: 'json' });
  await h.execute('cursor_cloud_spawn', { prompt: 'Task' });
  await flush();
  h.handles[0].runs[0].done.reject(new Error('Credential-free client error'));
  await flush();
  assert.equal((await h.status('00000001'))[0].status, 'failed');
  assert.match(h.messages[0].content, /failed/);
  assert.equal(h.widgets.length, 0);
});

test('ambiguous prefixes fail instead of selecting an agent', async t => {
  const h = harness(t);
  await h.execute('cursor_cloud_spawn', { prompt: 'One' });
  await h.execute('cursor_cloud_spawn', { prompt: 'Two' });
  await assert.rejects(h.execute('cursor_cloud_status', { id: '000' }), /Ambiguous/);
  assert.equal((await h.status()).length, 2);
});

test('shutdown detaches without cancelling and suppresses late session messages', async t => {
  const h = harness(t);
  await h.execute('cursor_cloud_spawn', { prompt: 'Task' });
  await flush();
  const handle = h.handles[0], run = handle.runs[0];
  h.events.get('session_shutdown')({}, h.ctx);
  assert.equal(handle.closed, true);
  assert.equal(run.cancelled, false);
  assert.equal(h.widgets.at(-1).factory, undefined);
  run.emit({ type: 'delta', activity: { type: 'thinking' } });
  run.done.resolve(outcome());
  await flush();
  assert.equal(h.messages.length, 0);
  await assert.rejects(h.execute('cursor_cloud_spawn', { prompt: 'After shutdown' }), /shut down/);
});

test('cancellation during starting waits for the run handle before cancelling', async t => {
  const h = harness(t, { pendingSend: true });
  await h.execute('cursor_cloud_spawn', { prompt: 'Task' });
  const run = h.handles[0].runs[0];
  const cancellation = h.execute('cursor_cloud_cancel', { id: '00000001' });
  assert.equal(run.cancelled, false);
  run.ready.resolve();
  await cancellation;
  await flush();
  assert.equal(run.cancelled, true);
  assert.equal((await h.status('00000001'))[0].status, 'cancelled');
});

test('send failure produces one completion and clears busy state', async t => {
  const h = harness(t, { pendingSend: true });
  await h.execute('cursor_cloud_spawn', { prompt: 'Task' });
  h.handles[0].runs[0].ready.reject(new Error('Cloud send failed.'));
  await flush();
  assert.equal((await h.status('00000001'))[0].status, 'failed');
  assert.equal(h.messages.length, 1);
  assert.match(h.messages[0].content, /Cloud send failed/);
});

test('deletion reserves an idle agent before asynchronous remote deletion', async t => {
  const gate = deferred();
  const h = harness(t, { deleteGate: gate });
  await h.execute('cursor_cloud_spawn', { prompt: 'Task' });
  h.handles[0].runs[0].done.resolve(outcome());
  await flush();
  const deletion = h.commands.get('cloud').handler('delete 00000001', h.ctx);
  await assert.rejects(h.execute('cursor_cloud_send', { id: '00000001', prompt: 'Race' }), /deletion is in progress/);
  gate.resolve();
  await deletion;
  assert.deepEqual(await h.status(), []);
});

test('an agent created during shutdown is closed without sending a paid prompt', async t => {
  const gate = deferred();
  const h = harness(t, { createGate: gate });
  const spawn = h.execute('cursor_cloud_spawn', { prompt: 'Task' });
  await flush();
  h.events.get('session_shutdown')({}, h.ctx);
  gate.resolve();
  await assert.rejects(spawn, /No prompt was sent/);
  assert.equal(h.handles[0].closed, true);
  assert.equal(h.handles[0].runs.length, 0);
});

test('menu entries without arguments ask for the prompt and the agent', async t => {
  const h = harness(t, { inputs: ['Check docs', 'Now the tests'], picks: [0] });
  const run = (args) => h.commands.get('cloud').handler(args, h.ctx);
  await run('spawn --name docs');
  assert.equal(h.asked[0], 'Cloud agent prompt');
  assert.equal(h.handles[0].runs[0].prompt, 'Check docs');
  assert.equal(h.handles[0].options.name, 'docs');
  h.handles[0].runs[0].done.resolve(outcome());
  await flush(); await flush();
  await run('send');
  assert.match(h.asked[1].options[0], /00000001 +docs/);
  assert.equal(h.handles[0].runs[1].prompt, 'Now the tests');
});

test('cancelled prompts and empty pickers stop without spending', async t => {
  const h = harness(t);
  await h.commands.get('cloud').handler('spawn', h.ctx);
  assert.equal(h.handles.length, 0);
  assert.deepEqual(h.notices.at(-1), { text: 'Cancelled.', level: 'info' });
  await h.commands.get('cloud').handler('cancel', h.ctx);
  assert.match(h.notices.at(-1).text, /No cloud agents fit/);
});

test('contributes a Cursor menu with only loaded commands', t => {
  const h = harness(t, { commandNames: ['cloud', 'cursor-mode'] });
  const added = [];
  h.busListeners.get('command-menu:collect:v1')({ version: 1, add: g => added.push(g) });
  assert.equal(added.length, 1);
  assert.equal(added[0].key, 'c');
  const flat = JSON.stringify(added[0]);
  assert.match(flat, /"name":"cloud","args":"spawn"/);
  assert.match(flat, /cursor-mode/);
  assert.doesNotMatch(flat, /cursor-runtime|cursor-fast|Maintenance/);
  h.busListeners.get('command-menu:collect:v1')({ version: 2, add: g => added.push(g) });
  assert.equal(added.length, 1);
});

test('/cloud open opens the Cursor page for a picked or named agent', async t => {
  const h = harness(t, { picks: [0] });
  await h.execute('cursor_cloud_spawn', { prompt: 'Look', name: 'look' });
  const id = h.handles[0].id;
  await h.commands.get('cloud').handler('open', h.ctx);
  await h.commands.get('cloud').handler(`open ${id.slice(3, 11)}`, h.ctx);
  assert.equal(h.opened.length, 2);
  for (const call of h.opened) assert.deepEqual(call.args, [`https://cursor.com/agents/${id}`]);
  assert.ok(h.notices.some(n => n.text.startsWith('Opened https://cursor.com/agents/')));
});

test('tool results and commands carry structured details for renderers', async t => {
  const h = harness(t);
  const spawned = await h.execute('cursor_cloud_spawn', { prompt: 'Look', name: 'look' });
  assert.equal(spawned.details.agent.name, 'look');
  assert.match(spawned.details.agent.url, /^https:\/\/cursor\.com\/agents\/bc-/);
  const status = await h.execute('cursor_cloud_status', {});
  assert.equal(status.details.agents[0].status, 'starting');
  JSON.parse(status.content[0].text);
  await h.commands.get('cloud').handler('list', h.ctx);
  assert.equal(h.messages.at(-1).details.kind, 'list');
  assert.ok(h.renderers.has('cursor-cloud-command'));
});

test('completion renderer requests a tidy component synchronously or shows all raw text', t => {
  const h = harness(t);
  const renderer = h.renderers.get('cursor-cloud-completion');
  const content = '# Raw heading\n**not styled**\n' + Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n');
  const message = { customType: 'cursor-cloud-completion', content };
  const theme = { fg: () => { throw new Error('raw fallback must not style'); } };
  assert.equal(renderer(message, { expanded: false }, theme).render(500).map(line => line.trimEnd()).join('\n'), content);
  assert.equal(renderer({ ...message, content: [{ type: 'text', text: '**raw**' }] }, { expanded: true }, theme).render(500)[0].trimEnd(), '**raw**');
  const tidy = new Text('tidy component', 0, 0);
  h.busListeners.set('tidy:message-card:v1', request => {
    assert.equal(request.version, 1);
    assert.equal(request.customType, 'cursor-cloud-completion');
    assert.equal(request.message, message);
    assert.equal(request.expanded, true);
    assert.equal(request.theme, theme);
    request.component = tidy;
  });
  assert.equal(renderer(message, { expanded: true }, theme), tidy);
});

test('/cloud model saves the default and spawn respects explicit, saved and built-in models', async t => {
  const h = harness(t);
  await h.execute('cursor_cloud_spawn', { prompt: 'Built-in' });
  assert.equal(h.handles[0].options.model, 'composer-2.5');
  await h.commands.get('cloud').handler('model custom-model', h.ctx);
  assert.deepEqual(JSON.parse(readFileSync(h.configPath, 'utf8')), { defaultModel: 'custom-model' });
  assert.deepEqual(h.notices.at(-1), { text: 'Default cloud model: custom-model', level: 'info' });
  assert.equal(h.messages.length, 0, 'configuration is not a model-facing message');
  await h.execute('cursor_cloud_spawn', { prompt: 'Saved' });
  await h.execute('cursor_cloud_spawn', { prompt: 'Override', model: 'explicit' });
  assert.equal(h.handles[1].options.model, 'custom-model');
  assert.equal(h.handles[2].options.model, 'explicit');
  const restored = harness(t, { savedModel: 'persisted' });
  await restored.execute('cursor_cloud_spawn', { prompt: 'Restored' });
  assert.equal(restored.handles[0].options.model, 'persisted');
});

test('/cloud model picker marks the current default and saves the selected SDK model', async t => {
  const h = harness(t, { models: [{ id: 'composer-2.5', displayName: 'Composer' }, { id: 'other', displayName: 'Other' }], picks: [1] });
  await h.commands.get('cloud').handler('model', h.ctx);
  assert.match(h.asked[0].options[0], /Composer.*composer-2\.5.*current default/);
  assert.deepEqual(JSON.parse(readFileSync(h.configPath, 'utf8')), { defaultModel: 'other' });
  await h.execute('cursor_cloud_spawn', { prompt: 'Use selection' });
  assert.equal(h.handles[0].options.model, 'other');
});

test('/cloud model falls back to input on discovery failure and cancellation preserves the default', async t => {
  const h = harness(t, { modelsError: true, inputs: ['manual'] });
  await h.commands.get('cloud').handler('model', h.ctx);
  assert.equal(h.asked[0], 'Default cloud model ID');
  assert.deepEqual(JSON.parse(readFileSync(h.configPath, 'utf8')), { defaultModel: 'manual' });
  const cancelled = harness(t, { savedModel: 'saved', models: [{ id: 'one' }] });
  await cancelled.commands.get('cloud').handler('model', cancelled.ctx);
  assert.deepEqual(JSON.parse(readFileSync(cancelled.configPath, 'utf8')), { defaultModel: 'saved' });
  assert.equal(cancelled.handles.length, 0);
  assert.deepEqual(cancelled.notices.at(-1), { text: 'Cancelled.', level: 'info' });
});
