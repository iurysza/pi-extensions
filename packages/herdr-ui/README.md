# Herdr UI

A dependency-free Node ESM adapter for explicit caller routing and owned terminal launches. It supports the Herdr app, verified live legacy Herdr, tmux and cmux.

```js
import { createHerdrUi } from '@iurysza/herdr-ui';
const ui = createHerdrUi();
const result = ui.launch({ cwd: '/project', argv: ['pi'], placement: 'split' });
if (!result.ok) console.error(result.error.message);
```

`resolveCaller`, `launch`, `openViewer`, `send` and `close` return `{ ok, value }` or `{ ok: false, error: { code, message } }`. Close accepts only the unchanged owned target returned by a launch, with a private ownership receipt on this machine. Do not use `send` to start a new program when `launch` can pass argv directly.

The `herdr-ui` CLI takes `resolve`, `launch`, `viewer`, `send` or `close`. All but `resolve` read one JSON request from stdin. Output is one JSON result with `version: 1`. Exit 0 is success, 1 an adapter error, and 2 invalid input. See `index.d.mts` for request types.

App context wins over inherited legacy context. Stale or ambiguous context fails rather than targeting focus. App split and tab launches can take focus. Legacy and cmux lack atomic argv launch, so the adapter closes its new pane if command submission fails.

App viewer popups currently fail closed. Herdr app 0.1.13 has no atomic open-if-idle API. A busy UI returns `popup_busy`; an idle UI returns `popup_atomicity_unavailable`. The adapter does not displace an existing popup, claim global overlay ownership, or create a hidden terminal in this case. Legacy viewers use their existing bundled plugin launcher.
