#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { createHerdrUi } from './index.mjs';
const adapter = createHerdrUi();
const command = process.argv[2];
let result;
let exit = 1;
try {
  if (!['resolve', 'launch', 'viewer', 'send', 'close'].includes(command) || process.argv.length !== 3) {
    result = { ok: false, error: { code: 'invalid_request', message: 'Usage: herdr-ui resolve|launch|viewer|send|close, with a JSON request on stdin.' } };
    exit = 2;
  } else {
    const request = command === 'resolve' ? null : JSON.parse(readFileSync(0, 'utf8'));
    if (command === 'resolve') result = adapter.resolveCaller();
    if (command === 'launch') result = adapter.launch(request);
    if (command === 'viewer') result = adapter.openViewer(request);
    if (command === 'send') result = adapter.send(request?.target, request?.text);
    if (command === 'close') result = adapter.close(request?.target);
  }
} catch {
  result = { ok: false, error: { code: 'invalid_request', message: 'Invalid JSON request or unavailable command input.' } };
  exit = 2;
}
console.log(JSON.stringify({ version: 1, ...result }));
process.exitCode = result.ok ? 0 : exit;
