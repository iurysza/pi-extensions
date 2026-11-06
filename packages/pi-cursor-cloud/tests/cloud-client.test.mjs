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

test('SDK errors map to safe, specific messages without keys, tokens or causes', async () => {
  const sdk = await import('@cursor/sdk');
  const key = 'crsr_fakeKey123456';
  const cause = { client: { apiKey: 'cause-secret' } };
  const base = { status: 400, requestId: 'req-123', cause };
  const cases = [
    [new sdk.AuthenticationError(`Invalid API key ${key}`, { ...base, status: 401, code: 'unauthenticated' }), /authentication rejected \(unauthenticated, HTTP 401\).*Team Admin API keys do not work/],
    [new sdk.IntegrationNotConnectedError(`[integration_not_connected] GitHub is not connected for ${key}`, { ...base, code: 'integration_not_connected', provider: 'github', helpUrl: 'https://cursor.com/dashboard/integrations' }),
      /GitHub integration not connected \(integration_not_connected, HTTP 400\).*Connect it: https:\/\/cursor\.com\/dashboard\/integrations/],
    [new sdk.RateLimitError(`Too many requests Bearer ${key}`, { ...base, status: 429, code: 'rate_limited' }), /rate limited \(rate_limited, HTTP 429\).*Retry later/],
    [new sdk.ConfigurationError(`[invalid_model] Unknown model api_key=${key}`, { ...base, code: 'invalid_model' }), /request rejected \(invalid_model, HTTP 400\).*Unknown model.*model, repository URL/],
    [new sdk.NetworkError(`[unavailable] down token: abc ${key}`, { ...base, status: 503, code: 'unavailable' }), /network or service error \(unavailable, HTTP 503\)/],
    [new sdk.AgentNotFoundError(`[agent_not_found] no agent ${key}`, { ...base, status: 404, code: 'agent_not_found' }), /agent not found .*never created/],
    [new sdk.UnknownAgentError(`odd ${key}`, base), /unexpected Cursor error/],
  ];
  for (const [error, pattern] of cases) {
    const message = cloudError(error, 'send', key);
    assert.match(message, /^Cursor Cloud send failed: /);
    assert.match(message, pattern);
    assert.match(message, /Request: req-123$/);
    for (const secret of [key, 'fakeKey', 'cause-secret', 'abc', 'apiKey', 'at ']) assert.ok(!message.includes(secret), `${secret} leaked: ${message}`);
    assert.ok(!message.includes('\n'));
  }
  const busy = new sdk.AgentBusyError(`[agent_busy] ${key}`, { status: 409, code: 'agent_busy' });
  assert.match(cloudError(busy, 'send', key), /Wait until it is idle/);
});

test('SDK errors are recognised by name and server text is capped and single-line', () => {
  const key = 'k-123';
  const error = Object.assign(new Error(`${'x'.repeat(500)}\nline two ${key}`), { name: 'RateLimitError', status: 429 });
  const message = cloudError(error, 'create', key);
  assert.match(message, /create failed: rate limited \(HTTP 429\)/);
  assert.ok(message.length < 500);
  assert.ok(!message.includes('\n') && !message.includes(key));
  const integration = Object.assign(new Error('not connected'), { name: 'IntegrationNotConnectedError', provider: 'github', helpUrl: 'http://evil.example' });
  assert.doesNotMatch(cloudError(integration, 'send'), /evil/);
});

test('unknown non-SDK errors keep the generic message', () => {
  const generic = 'Cursor Cloud send failed. Check authentication, repository access, and Cursor service availability.';
  assert.equal(cloudError(new Error('crsr_secret Bearer x'), 'send', 'crsr_secret'), generic);
  assert.equal(cloudError(new TypeError('boom'), 'send'), generic);
  assert.equal(cloudError('string error', 'send'), generic);
});
