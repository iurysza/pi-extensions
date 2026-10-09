import test from 'node:test';
import assert from 'node:assert/strict';
import { visibleWidth } from '@earendil-works/pi-tui';
import { renderWidget, formatCompletion, cleanText } from '../src/render.js';

const theme = { fg: (color, text) => `[${color}:${text}]`, bold: text => `[bold:${text}]` };
const plain = { fg: (_color, text) => text, bold: text => text };
const make = (id = 'bc-12345678') => ({ id, name: 'docs', description: 'Review docs', repo: 'https://github.com/owner/repo', ref: 'main', model: 'composer-2-5', startedAt: 1000, status: { type: 'running', runId: 'run' }, activity: 'run_terminal_cmd: ls docs', text: '', tools: 3, toolCallIds: [] });

test('running tree matches semantic theme and subagents layout', () => {
  assert.deepEqual(renderWidget([make()], theme, 500, 0, 29000), [
    '[accent:● Cloud agents]',
    '[dim:└─] [accent:⠋] [bold:docs] [dim:12345678]  [dim:Review docs] [dim:· 0:28 · 3 tools]',
    '[dim:     ⎿  run_terminal_cmd: ls docs]',
  ]);
});

test('settled icons linger then disappear without removing history', () => {
  for (const [type, icon] of [['idle', '✓'], ['failed', '✗'], ['cancelled', '■']]) {
    const a = { ...make(), status: { type, endedAt: 29000, error: 'Oops', result: { text: 'Done', durationMs: 28000, branches: [] } } };
    const lines = renderWidget([a], plain, 100, 0, 30000);
    assert.equal(lines[0], '○ Cloud agents');
    assert.match(lines[1], new RegExp(icon));
    assert.equal(lines.length, 2);
    assert.deepEqual(renderWidget([a], plain, 100, 0, 89000), []);
  }
});

test('overflow prioritizes active agents and never exceeds 12 lines', () => {
  const agents = Array.from({ length: 9 }, (_, i) => make(`bc-${i}2345678`));
  const lines = renderWidget(agents, plain, 100, 0, 29000);
  assert.equal(lines.length, 12);
  assert.equal(lines.at(-1), '└─ +4 more');
  assert.match(lines[1], /^├─/);
});

test('narrow terminals and untrusted control codes stay within terminal width', () => {
  const a = { ...make(), name: '\x1b[31m漢字\x1b[0m\nA', activity: '\x1b[2JBad\nline\x00' };
  for (const width of [1, 10, 40, 80]) {
    const lines = renderWidget([a], plain, width, 5, 29000);
    assert.ok(lines.every(line => visibleWidth(line) <= width));
    assert.ok(lines.every(line => !line.includes('\n') && !line.includes('\x1b[2J')));
  }
  assert.deepEqual(renderWidget([], plain, 80, 0, 0), []);
  assert.equal(cleanText('\x1b[2JHello\x00'), 'Hello');
});

test('long prompts leave space for elapsed and tool statistics', () => {
  const a = { ...make(), description: 'Very long prompt. '.repeat(100) };
  const lines = renderWidget([a], plain, 80, 0, 29000);
  assert.match(lines[1], /· 0:28 · 3 tools/);
  assert.ok(visibleWidth(lines[1]) <= 80);
});

test('completion includes duration result and branch or PR metadata', () => {
  const a = { ...make(), status: { type: 'idle', endedAt: 29000, result: { text: 'Docs checked.', durationMs: 28000, branches: [{ repoUrl: 'https://github.com/owner/repo', branch: 'cursor/docs', prUrl: 'https://github.com/owner/repo/pull/1' }] } } };
  assert.equal(formatCompletion(a), 'Cloud agent docs (12345678) finished · 0:28\n\nDocs checked.\n\nhttps://github.com/owner/repo · branch: cursor/docs · PR: https://github.com/owner/repo/pull/1\n\nOpen: https://cursor.com/agents/' + a.id);
});

test('agent links point at the Cursor web page for the full id', async () => {
  const { agentUrl } = await import('../src/render.js');
  assert.equal(agentUrl('bc-34f7b2b2-8439'), 'https://cursor.com/agents/bc-34f7b2b2-8439');
});
