#!/usr/bin/env node
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
const command = basename(process.argv[1]);
const args = process.argv.slice(2);
const config = JSON.parse(readFileSync(process.env.FAKE_CONFIG, 'utf8'));
appendFileSync(process.env.FAKE_LOG, JSON.stringify({ command, args, appHome: process.env.HERDR_APP_HOME }) + '\n');
const emit = value => { console.log(typeof value === 'string' ? value : JSON.stringify(value)); };
if (config.fail === `${command} ${args[0]}` || config.fail === `${command} ${args.slice(0, 2).join(' ')}`) process.exit(1);
if (command === 'herdr-app') {
  if (args[0] === 'ls') emit(config.listing ?? { spaces: [{ id: 'sp1', machine: null, tabs: [{ id: 'tb1', terminals: [{ pane: 'p1', terminal: 't1' }] }] }] });
  else if (args[0] === 'status') emit(config.status ?? { focused_pane: 'p1', agent: 't1', space: 'sp1', tab: 'tb1', overlays: [] });
  else emit(config.created ?? (args[1] === 'tab.new' ? { space: 'sp1', tab: 'tb2', terminal: 't2' } : { pane: 'p2', terminal: 't2' }));
} else if (command === 'herdr') {
  if (args[0] === 'pane' && args[1] === 'current') emit(config.current ?? { result: { pane: { pane_id: 'w1:p1', workspace_id: 'w1' } } });
  else if (args[0] === 'pane' && args[1] === 'split') emit({ result: { pane: { pane_id: 'w1:p2' } } });
  else if (args[0] === 'tab') emit({ result: { root_pane: { pane_id: 'w1:p2' } } });
  else if (args[0] === 'plugin' && args[1] === 'pane') {
    const flag = `${process.env.FAKE_CONFIG}.linked`;
    if (config.pluginMissing && !existsSync(flag)) { emit({ error: { code: 'plugin_not_found' } }); process.exit(1); }
    if (config.pluginBusy) { emit({ error: { code: 'popup_busy' } }); process.exit(1); }
    emit({ result: { type: 'plugin_pane_opened', plugin_pane: { plugin_id: 'viewer', entrypoint: 'file', pane: { pane_id: 'w1:p9' } } } });
  } else if (args[0] === 'plugin' && args[1] === 'link') { writeFileSync(`${process.env.FAKE_CONFIG}.linked`, 'yes'); emit({ result: {} }); }
  else emit({ result: {} });
} else if (command === 'tmux') emit('%7');
else if (command === 'cmux') emit('OK surface:8');
else emit({ ok: true });
