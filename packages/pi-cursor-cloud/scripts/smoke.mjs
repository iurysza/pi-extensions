#!/usr/bin/env node
import { createCloudClient } from '../dist/src/cloud-client.js';
import { reduce } from '../dist/src/state.js';
import { renderWidget, formatCompletion } from '../dist/src/render.js';

const client = createCloudClient();
const theme = { fg: (_color, text) => text, bold: text => text };
let state = [], frame = 0, handle, run, ticker, timeout, completed = false;
const draw = () => console.log(renderWidget(state, theme, 120, frame++, Date.now()).join('\n'));
try {
  const options = { repo: 'https://github.com/iurysza/agents2', ref: 'main', model: 'composer-2-5', name: 'smoke' };
  handle = await client.create(options);
  state = reduce(state, { type: 'spawned', agent: { id: handle.id, ...options, description: 'Read-only. Run ls docs',
    startedAt: Date.now(), status: { type: 'starting' }, activity: 'starting…', text: '', tools: 0, toolCallIds: [] } });
  draw();
  ticker = setInterval(draw, 3000);
  run = await handle.send('Read-only. Run ls docs and reply with one sentence.', event => {
    state = reduce(state, { ...event, id: handle.id });
  });
  state = reduce(state, { type: 'running', id: handle.id, runId: run.id });
  const result = await Promise.race([
    run.wait(),
    new Promise((_resolve, reject) => { timeout = setTimeout(() => reject(new Error('Smoke timed out after 180 seconds.')), 180000); }),
  ]);
  completed = true;
  state = reduce(state, { ...result, id: handle.id, now: Date.now() });
  draw();
  console.log('\n' + formatCompletion(state[0]));
  if (result.type !== 'finished') process.exitCode = 1;
} catch (error) {
  // cloud-client emits only credential-free errors. Never inspect SDK handles or raw SDK responses.
  console.error(error instanceof Error ? error.message : 'Cloud smoke failed.');
  process.exitCode = 1;
} finally {
  clearInterval(ticker);
  clearTimeout(timeout);
  if (run && !completed) {
    try { await run.cancel(); } catch { console.error('Smoke cancellation failed; check Cursor.'); }
  }
  if (handle) {
    try { handle.close(); } catch { console.error('Smoke handle close failed.'); }
    try { await client.delete(handle.id); console.log('Smoke agent deleted.'); }
    catch { console.error('Smoke cleanup failed; delete the smoke agent in Cursor.'); process.exitCode = 1; }
  }
}
