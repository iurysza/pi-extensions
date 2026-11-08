import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

const ok = value => ({ ok: true, value });
const fail = (code, message) => ({ ok: false, error: { code, message } });
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonempty = value => typeof value === 'string' && value.length > 0 && !value.includes('\0');
const paneId = value => typeof value === 'string' && /^[A-Za-z0-9._:-]+$/.test(value);
const appPane = value => typeof value === 'string' && /^p[0-9a-f]+$/.test(value);
const terminalId = value => typeof value === 'string' && /^t[0-9a-z]+$/.test(value);
const quote = value => `'${value.replaceAll("'", "'\"'\"'")}'`;
const commandLine = argv => argv.map(quote).join(' ');
const reopen = 'Reopen or restart Pi inside the intended Herdr pane.';

/** No shell, no credential-bearing argv or environment in diagnostics. */
function execute(env, command, args) {
  try {
    const out = spawnSync(command, args, { env, encoding: 'utf8' });
    if (out.error || out.status !== 0) return fail('command_failed', `${command} ${args[0] ?? ''} failed; check that the CLI and selected server are available.`);
    return ok(out.stdout.trim());
  } catch {
    return fail('command_failed', `${command} could not run.`);
  }
}
function json(result, label) {
  if (!result.ok) return result;
  try {
    const value = JSON.parse(result.value);
    if (!object(value) || value.error || value.ok === false) return fail('invalid_response', `${label} returned an error or invalid object.`);
    return ok(value);
  } catch {
    return fail('invalid_response', `${label} returned malformed JSON.`);
  }
}

export function createHerdrUi(options = {}) {
  const env = { ...(options.env ?? process.env) };
  const appHome = resolve(env.HERDR_APP_HOME || join(env.HOME || homedir(), '.config', 'herdr-app'));
  // Canonicalize selection so later cleanup cannot accidentally address another app.
  const appEnv = { ...env, HERDR_APP_HOME: appHome };
  const legacyBin = env.HERDR_BIN_PATH || 'herdr';
  const run = (command, args, selectedEnv = env) => execute(selectedEnv, command, args);
  const app = (args, selectedEnv = appEnv) => json(run('herdr-app', args, selectedEnv), 'herdr-app');
  const legacy = args => json(run(legacyBin, args), 'herdr');
  // A random receipt is proof of adapter ownership, not an arbitrary terminal ID.
  const receiptDir = join(tmpdir(), `herdr-ui-${process.getuid?.() ?? 'user'}`);
  const receiptPath = token => join(receiptDir, `${token}.json`);

  function resolveCaller() {
    if (env.HC_TERMINAL_ID !== undefined) {
      if (!terminalId(env.HC_TERMINAL_ID)) return fail('stale_context', `Invalid app terminal context. ${reopen}`);
      const listing = app(['ls']);
      if (!listing.ok) return fail(listing.error.code, `${listing.error.message} ${reopen}`);
      if (!Array.isArray(listing.value.spaces)) return fail('invalid_response', `App spaces are missing. ${reopen}`);
      const matches = [];
      for (const space of listing.value.spaces) {
        if (!object(space) || !Array.isArray(space.tabs)) return fail('invalid_response', `App space is malformed. ${reopen}`);
        for (const tab of space.tabs) {
          if (!object(tab) || !Array.isArray(tab.terminals)) return fail('invalid_response', `App tab is malformed. ${reopen}`);
          for (const terminal of tab.terminals) {
            if (terminal?.terminal === env.HC_TERMINAL_ID) matches.push({ space, tab, terminal });
          }
        }
      }
      if (matches.length !== 1) return fail('stale_context', `App terminal must map to exactly one pane; found ${matches.length}. ${reopen}`);
      const { space, tab, terminal } = matches[0];
      if (space.machine || !appPane(terminal.pane) || !/^sp[0-9a-f]+$/.test(space.id) || !/^tb[0-9a-f]+$/.test(tab.id)) {
        return fail('stale_context', `App caller has an unsupported remote or malformed pane mapping. ${reopen}`);
      }
      return ok({ backend: 'app', terminal: env.HC_TERMINAL_ID, pane: terminal.pane, space: space.id, tab: tab.id, appHome });
    }
    if (env.HERDR_ENV === '1') {
      if (!paneId(env.HERDR_PANE_ID)) return fail('stale_context', `Legacy Herdr pane context is missing. ${reopen}`);
      const current = legacy(['pane', 'current']);
      if (!current.ok) return fail(current.error.code, `${current.error.message} ${reopen}`);
      const pane = current.value.result?.pane;
      if (!object(pane) || pane.pane_id !== env.HERDR_PANE_ID || !paneId(pane.workspace_id)) return fail('stale_context', `Legacy Herdr caller is no longer live. ${reopen}`);
      return ok({ backend: 'legacy', pane: pane.pane_id, workspace: pane.workspace_id });
    }
    if (env.TMUX) return ok({ backend: 'tmux' });
    if (env.CMUX_SOCKET_PATH) return ok({ backend: 'cmux' });
    return ok({ backend: 'none' });
  }

  function own(target) {
    const ownership = randomUUID();
    const owned = { ...target, ownership };
    try {
      mkdirSync(receiptDir, { recursive: true, mode: 0o700 });
      // Store only connection selectors, never the prompt or full environment.
      const selectors = {};
      for (const key of ['HERDR_BIN_PATH', 'HERDR_SOCKET_PATH', 'HERDR_SOCKET', 'CMUX_SOCKET_PATH', 'TMUX']) {
        if (env[key]) selectors[key] = env[key];
      }
      writeFileSync(receiptPath(ownership), JSON.stringify({ target: owned, selectors }), { mode: 0o600, flag: 'wx' });
      return ok(owned);
    } catch {
      const cleaned = closeBackend(target, env);
      const error = fail('ownership_failed', 'Could not save ownership receipt; attempted to close the new terminal.');
      if (!cleaned.ok) error.error.cleanup = cleaned.error;
      return error;
    }
  }

  function loadOwned(target) {
    if (!object(target) || typeof target.ownership !== 'string' || !/^[0-9a-f-]{36}$/.test(target.ownership)) return fail('not_owned', 'Cleanup requires a target returned by this adapter.');
    try {
      const receipt = JSON.parse(readFileSync(receiptPath(target.ownership), 'utf8'));
      if (Object.keys(receipt.target).length !== Object.keys(target).length || Object.entries(receipt.target).some(([key, value]) => target[key] !== value)) return fail('not_owned', 'Target does not match its ownership receipt.');
      return ok(receipt);
    } catch {
      return fail('not_owned', 'Ownership receipt is missing; refusing to touch this terminal.');
    }
  }

  function closeBackend(target, selectedEnv) {
    if (target.backend === 'app') {
      const killed = run('hc', ['kill', target.terminal], selectedEnv);
      // rm also succeeds for an already-exited viewer, where kill may fail.
      const removed = run('hc', ['rm', target.terminal], selectedEnv);
      return removed.ok ? ok(null) : (killed.ok ? removed : killed);
    }
    if (target.backend === 'legacy') return run(selectedEnv.HERDR_BIN_PATH || 'herdr', [...(target.placement === 'popup' ? ['plugin', 'pane', 'close'] : ['pane', 'close']), target.id], selectedEnv);
    if (target.backend === 'tmux') return run('tmux', ['kill-pane', '-t', target.id], selectedEnv);
    if (target.backend === 'cmux') return run('cmux', ['close-surface', '--surface', target.id], selectedEnv);
    return fail('invalid_target', 'Unknown target backend.');
  }

  function close(target) {
    const owned = loadOwned(target);
    if (!owned.ok) return owned;
    const result = closeBackend(target, { ...env, ...owned.value.selectors, HERDR_APP_HOME: target.appHome ?? appHome });
    if (!result.ok) return result;
    try { unlinkSync(receiptPath(target.ownership)); } catch (error) {
      if (error?.code !== 'ENOENT') return fail('ownership_cleanup_failed', 'Terminal closed, but its ownership receipt could not be removed.');
    }
    return ok(null);
  }

  function send(target, text) {
    const owned = loadOwned(target);
    if (!owned.ok) return owned;
    if (!nonempty(text)) return fail('invalid_request', 'Text must be nonempty.');
    const selectedEnv = { ...env, ...owned.value.selectors };
    if (target.backend === 'app') return run('hc', ['send', target.terminal, text], selectedEnv);
    if (target.backend === 'legacy') return run(selectedEnv.HERDR_BIN_PATH || 'herdr', ['pane', 'run', target.id, text], selectedEnv);
    if (target.backend === 'tmux') return run('tmux', ['send-keys', '-t', target.id, '-l', text], selectedEnv).ok
      ? run('tmux', ['send-keys', '-t', target.id, 'Enter'], selectedEnv)
      : fail('command_failed', 'tmux send-keys failed.');
    return run('cmux', ['send', '--surface', target.id, `${text}\n`], selectedEnv);
  }

  function validLaunch(request) {
    return object(request) && nonempty(request.cwd) && isAbsolute(request.cwd)
      && Array.isArray(request.argv) && request.argv.length > 0 && nonempty(request.argv[0])
      && request.argv.every(arg => typeof arg === 'string' && !arg.includes('\0'));
  }

  function launch(request, resolved) {
    if (!validLaunch(request) || !['split', 'tab'].includes(request.placement)
      || (request.direction !== undefined && !['right', 'down'].includes(request.direction))
      || (request.name !== undefined && !nonempty(request.name))) return fail('invalid_request', 'Launch requires absolute cwd, nonempty argv, and split or tab placement.');
    const caller = resolved ?? resolveCaller();
    if (!caller.ok) return caller;
    const { backend } = caller.value;
    if (backend === 'none') return fail('unsupported_backend', 'No supported multiplexer detected.');
    const placement = request.placement;
    const direction = request.direction ?? 'right';
    if (backend === 'app') {
      const args = placement === 'split'
        ? { direction, pane: caller.value.pane, argv: ['sh', '-c', 'cd -- "$1" && shift && exec "$@"', 'herdr-ui', request.cwd, ...request.argv] }
        : { name: request.name ?? 'Pi', space: caller.value.space, folder: request.cwd, argv: request.argv };
      const launched = app(['do', placement === 'split' ? 'pane.split' : 'tab.new', JSON.stringify(args)]);
      if (!launched.ok) return launched;
      const { pane, terminal, tab, space } = launched.value;
      const id = placement === 'split' ? pane : tab;
      const validId = placement === 'split' ? appPane(pane) && pane !== caller.value.pane : typeof tab === 'string' && /^tb[0-9a-f]+$/.test(tab) && tab !== caller.value.tab && space === caller.value.space;
      if (!terminalId(terminal) || terminal === caller.value.terminal) return fail('invalid_response', 'App launch returned no distinct valid terminal ID; inspect the app for an untracked launch.');
      if (!validId) {
        const error = fail('invalid_response', 'App launch returned malformed pane or tab IDs; attempted cleanup of its returned terminal.');
        const cleaned = closeBackend({ backend, terminal }, appEnv);
        if (!cleaned.ok) error.error.cleanup = cleaned.error;
        return error;
      }
      return own({ backend, id, terminal, placement, appHome });
    }
    let created;
    if (backend === 'legacy') {
      created = legacy(placement === 'split'
        ? ['pane', 'split', caller.value.pane, '--direction', direction, '--cwd', request.cwd, '--no-focus']
        : ['tab', 'create', '--workspace', caller.value.workspace, '--cwd', request.cwd, '--label', request.name ?? 'Pi', '--no-focus']);
      if (!created.ok) return created;
      const id = placement === 'split' ? created.value.result?.pane?.pane_id : created.value.result?.root_pane?.pane_id;
      if (!paneId(id) || id === caller.value.pane) return fail('invalid_response', 'Legacy launch returned no distinct pane ID; inspect Herdr for an untracked launch.');
      const target = own({ backend, id, placement });
      if (!target.ok) return target;
      const sent = send(target.value, `exec ${commandLine(request.argv)}`);
      if (sent.ok) return target;
      const cleaned = close(target.value);
      if (!cleaned.ok) sent.error.cleanup = cleaned.error;
      return sent;
    }
    if (backend === 'tmux') {
      created = run('tmux', placement === 'split'
        ? ['split-window', direction === 'right' ? '-h' : '-v', '-c', request.cwd, '-P', '-F', '#{pane_id}', ...request.argv]
        : ['new-window', '-c', request.cwd, '-n', request.name ?? 'Pi', '-P', '-F', '#{pane_id}', ...request.argv]);
      if (!created.ok) return created;
      if (!/^%\d+$/.test(created.value)) return fail('invalid_response', 'tmux returned no pane ID.');
      return own({ backend, id: created.value, placement });
    }
    created = run('cmux', placement === 'split' ? ['new-split', direction] : ['new-tab']);
    if (!created.ok) return created;
    const id = created.value.match(/\bsurface:\d+\b/)?.[0];
    if (!id) return fail('invalid_response', 'cmux returned no surface ID.');
    const target = own({ backend, id, placement });
    if (!target.ok) return target;
    if (placement === 'tab' && request.name) {
      const renamed = run('cmux', ['rename-tab', '--surface', id, request.name]);
      if (!renamed.ok) {
        const cleaned = close(target.value);
        if (!cleaned.ok) renamed.error.cleanup = cleaned.error;
        return renamed;
      }
    }
    const sent = send(target.value, `cd ${quote(request.cwd)} && exec ${commandLine(request.argv)}`);
    if (sent.ok) return target;
    const cleaned = close(target.value);
    if (!cleaned.ok) sent.error.cleanup = cleaned.error;
    return sent;
  }

  function openViewer(request) {
    if (!validLaunch(request) || (request.name !== undefined && !nonempty(request.name))) return fail('invalid_request', 'Viewer requires absolute cwd and nonempty argv.');
    const caller = resolveCaller();
    if (!caller.ok) return caller;
    // The app has no owned atomic popup, so viewers get their own tab in the
    // caller's space. Never terminal.peek or global overlay.close.
    if (caller.value.backend === 'app') return launch({ cwd: request.cwd, argv: request.argv, placement: 'tab', name: request.name ?? 'Viewer' }, caller);
    if (caller.value.backend !== 'legacy') return launch({ cwd: request.cwd, argv: request.argv, placement: 'split' }, caller);
    const spec = request.legacy;
    if (!object(spec) || !nonempty(spec.plugin) || !nonempty(spec.entrypoint) || !nonempty(spec.root)
      || (spec.env !== undefined && (!object(spec.env) || !Object.entries(spec.env).every(([key, value]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && typeof value === 'string' && !value.includes('\0'))))) return fail('invalid_request', 'Legacy viewer requires plugin, entrypoint, root, and valid environment entries.');
    const args = ['plugin', 'pane', 'open', '--plugin', spec.plugin, '--entrypoint', spec.entrypoint, '--placement', 'popup', '--target-pane', caller.value.pane, '--workspace', caller.value.workspace, '--cwd', request.cwd];
    for (const [key, value] of Object.entries(spec.env ?? {})) args.push('--env', `${key}=${value}`);
    args.push('--focus');
    // Retrying only plugin_not_found avoids linking on busy, stale or launch errors.
    const opened = spawnSync(legacyBin, args, { env, encoding: 'utf8' });
    let response = opened;
    if (opened.status !== 0 && /\bplugin_not_found\b/.test(`${opened.stdout}\n${opened.stderr}`)) {
      const linked = run(legacyBin, ['plugin', 'link', spec.root]);
      if (!linked.ok) return linked;
      response = spawnSync(legacyBin, args, { env, encoding: 'utf8' });
    }
    if (response.error || response.status !== 0) return fail('viewer_failed', 'Herdr viewer failed; check the plugin installation and close any busy popup yourself.');
    const parsed = json(ok(response.stdout), 'herdr viewer');
    if (!parsed.ok) return parsed;
    const id = parsed.value.result?.plugin_pane?.pane?.pane_id;
    if (!paneId(id) || id === caller.value.pane) return fail('invalid_response', 'Herdr viewer returned no distinct owned pane ID.');
    return own({ backend: 'legacy', id, placement: 'popup' });
  }
  return { resolveCaller, launch: request => launch(request), openViewer, send, close };
}
