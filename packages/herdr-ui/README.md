# Herdr UI

A dependency-free Node ESM adapter for explicit caller routing and owned terminal launches. It supports the Herdr app, verified live legacy Herdr, rex, tmux and cmux.

```js
import { createHerdrUi } from '@iurysza/herdr-ui';
const ui = createHerdrUi();
const result = ui.launch({ cwd: '/project', argv: ['pi'], placement: 'split' });
if (!result.ok) console.error(result.error.message);
```

`resolveCaller`, `launch`, `float`, `openViewer`, `send` and `close` return `{ ok, value }` or `{ ok: false, error: { code, message } }`. Close accepts only the unchanged owned target returned by a launch, with a private ownership receipt on this machine. Do not use `send` to start a new program when `launch` can pass argv directly.

The `herdr-ui` CLI takes `resolve`, `launch`, `float`, `viewer`, `send` or `close`. All but `resolve` read one JSON request from stdin. Output is one JSON result with `version: 1`. Exit 0 is success, 1 an adapter error, and 2 invalid input. See `index.d.mts` for request types.

App context wins over inherited legacy context. Stale or ambiguous context fails rather than targeting focus. App split and tab launches can take focus. Legacy and cmux lack atomic argv launch, so the adapter closes its new pane if command submission fails.

`float({ cwd, argv, name?, width?, height? })` opens a floating pane over the caller that runs argv in cwd and goes away when the program exits. `width` and `height` are fractions of the window, default 0.8, centred.

- Herdr app: `hc run --bg --rm` starts the terminal as the caller's child, then `herdr-app do terminal.peek` shows it. Peek retries for about 3 seconds while the app has not listed the new terminal yet, then fails and closes the terminal. Peek has no size, so `width` and `height` are ignored. The hc name is the sanitised `name` plus a short random suffix.
- rex (`REX_SESSION` and `REX_BLOCK` set): `session.new_layer` in the caller's window. Binary: `REX_BIN`, else `rex` on `PATH`, else the Rex Server app bundle. `shell: "none"` starts argv directly with the rex server's environment and `PATH`, so pass absolute paths or `env` when that matters.
- legacy Herdr, tmux, cmux, none: `float_unsupported`. tmux popups are out of scope.

`close` on a float kills and removes the app terminal, or closes the rex layer. A float that already ended counts as closed.

`openViewer` floats for app and rex callers. If an app float fails, it opens a tab in the caller's space and returns the float error as `warning`; if both fail, the error names both. Legacy viewers use their bundled plugin popup. tmux and cmux viewers open a split.
