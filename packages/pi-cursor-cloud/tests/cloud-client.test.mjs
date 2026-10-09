import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Cursor } from '@cursor/sdk';
import { mapDelta, mapStep, mapCompletion, cloudError, redact, readApiKey, createCloudClient } from '../src/cloud-client.js';

test('cloud client lists model ids and names with injected credentials, without SDK internals', async t => {
  t.mock.method(Cursor.models, 'list', async ({ apiKey }) => {
    assert.equal(apiKey, 'fake-key');
    return [{ id: 'composer-2-5', displayName: 'Composer', parameters: [{ id: 'effort' }] }];
  });
  assert.deepEqual(await createCloudClient(async () => 'fake-key').models(), [{ id: 'composer-2-5', displayName: 'Composer' }]);
});

test('model listing failures do not expose raw SDK errors or credentials', async t => {
  t.mock.method(Cursor.models, 'list', async () => { throw new Error('fake-key internal client'); });
  await assert.rejects(createCloudClient(async () => 'fake-key').models(), error => /model listing failed/.test(error.message) && !error.message.includes('fake-key'));
});

test('SDK callback fields map to plain lifecycle activities', () => {
  assert.deepEqual(mapDelta({ type: 'thinking-delta', text: 'private thought' }), { type: 'delta', activity: { type: 'thinking' } });
  assert.deepEqual(mapDelta({ type: 'tool-call-started', callId: 'tool-1', toolCall: { type: 'shell', args: { command: 'ls docs' } } }), { type: 'delta', activity: { type: 'tool', callId: 'tool-1', activity: 'run_terminal_cmd: ls docs' } });
  assert.deepEqual(mapStep({ type: 'assistantMessage', message: { text: 'Done' } }), { type: 'step', activity: { type: 'text', text: 'Done', replace: true } });
  assert.equal(mapDelta({ type: 'token-delta', tokens: 3 }), undefined);
});

test('completion never serializes SDK clients and redacts the key from plain text fields', () => {
  const key = 'test-secret-never-output';
  const raw = { status: 'finished', result: `Done ${key}`, durationMs: 42, git: { branches: [{ repoUrl: 'repo', branch: key, prUrl: key, client: { apiKey: key } }] }, client: { apiKey: key } };
  const mapped = mapCompletion(raw, key);
  assert.equal(mapped.type, 'finished');
  assert.equal(mapped.result.durationMs, 42);
  assert.ok(!JSON.stringify(mapped).includes(key));
  assert.ok(!JSON.stringify(mapped).includes('client'));
  assert.equal(redact(key, key), '[redacted]');
  assert.equal(cloudError(new Error(`client apiKey=${key}`), 'send').includes(key), false);
  assert.match(cloudError(new Error(`[agent_busy] ${key}`), 'send'), /Wait until it is idle/);
});

test('auth store fallback reads only cursor.key and fails without exposing parsed secrets', async () => {
  const directory = await mkdtemp(join(process.cwd(), '.cloud-auth-test-'));
  const oldKey = process.env.CURSOR_API_KEY;
  const oldDirectory = process.env.PI_CODING_AGENT_DIR;
  try {
    delete process.env.CURSOR_API_KEY;
    process.env.PI_CODING_AGENT_DIR = directory;
    await writeFile(join(directory, 'auth.json'), JSON.stringify({ cursor: { key: ' test-auth-key ' } }), { mode: 0o600 });
    assert.equal(await readApiKey(), 'test-auth-key');
    await writeFile(join(directory, 'auth.json'), JSON.stringify({ anotherProvider: { key: 'other-secret' } }));
    await assert.rejects(readApiKey(), error => /Cursor Cloud needs/.test(error.message) && !error.message.includes('other-secret'));
  } finally {
    if (oldKey === undefined) delete process.env.CURSOR_API_KEY;
    else process.env.CURSOR_API_KEY = oldKey;
    if (oldDirectory === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = oldDirectory;
    await rm(directory, { recursive: true, force: true });
  }
});

test('environment credential takes precedence without reading or logging the auth store', async () => {
  const previous = process.env.CURSOR_API_KEY;
  try {
    process.env.CURSOR_API_KEY = ' test-key ';
    assert.equal(await readApiKey(), 'test-key');
  } finally {
    if (previous === undefined) delete process.env.CURSOR_API_KEY;
    else process.env.CURSOR_API_KEY = previous;
  }
});
