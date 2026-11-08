import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHerdrUi } from '../index.mjs';

export function fixture(t, config = {}, context = {}) {
  const root = mkdtempSync(join(tmpdir(), 'herdr-ui-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const binary of ['herdr-app', 'hc', 'herdr', 'tmux', 'cmux']) {
    const path = join(root, binary);
    writeFileSync(path, `#!${process.execPath}\n${readFileSync(resolve(import.meta.dirname, 'fake-cli.mjs'), 'utf8').split('\n').slice(1).join('\n')}`);
    chmodSync(path, 0o755);
  }
  const configFile = join(root, 'config.json');
  const log = join(root, 'calls.jsonl');
  writeFileSync(configFile, JSON.stringify(config));
  writeFileSync(log, '');
  const env = { ...process.env, PATH: root, HC_TERMINAL_ID: undefined, HERDR_ENV: undefined, HERDR_PANE_ID: undefined, HERDR_BIN_PATH: undefined, TMUX: undefined, CMUX_SOCKET_PATH: undefined, ...context, FAKE_CONFIG: configFile, FAKE_LOG: log };
  return { root, env, ui: createHerdrUi({ env }), calls: () => readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) };
}
