## Implementation plan — pi-follow-up tree-style UI

### Locked decisions

- Opener stays `shift+↑`. Inert until the widget exists (no spinner, no placeholder).
- Resting state: one-line teaser widget above the editor; appears only when suggestions are ready.
- Overlay: modal, center-anchored, `maxHeight: "85%"`. No search, no filter, no truncation of suggestions. Esc closes, widget stays. Enter sends (widget cleared), shift+enter inserts (widget stays).
- Generation, threshold, abort, and config logic untouched.

### 1. `packages/pi-follow-up/src/core.ts` — shrink the state model

Remove `SuggestionSelection` and `selectSuggestion` (they only existed for in-widget navigation). Keep `ConversationMessage`, `recentConversation`, `parseSuggestions`, `textFromContent`, `visibleUnicodeCharacterCount`.

Extension state becomes:

```ts
let suggestions: readonly string[] | undefined;
```

### 2. `packages/pi-follow-up/src/index.ts` — rework UI layer

**Teaser widget** replaces `widgetLines`/`renderWidget`:

```ts
function renderWidget(ctx: ExtensionContext, suggestions: readonly string[] | undefined): void {
  if (!suggestions?.length) { ctx.ui.setWidget(WIDGET_KEY, undefined); return; }
  ctx.ui.setWidget(WIDGET_KEY, (_tui, theme) => ({
    render: (width: number) => [
      truncateToWidth(
        theme.fg("dim", `Follow-up: "${suggestions[0]}" +${suggestions.length - 1} more · shift+↑ open`),
        width),
    ],
    invalidate() {},
  }), { placement: "aboveEditor" });
}
```

**Drop** `focusedIndex` handling in `handleTerminalInput` — it keeps only the opener:

```ts
if (!suggestions || !matchesKey(data, "shift+up")) return undefined;
void openOverlay(ctx);
return { consume: true };
```

**New `FollowUpPicker` component** (no SelectList, no Input — local state + `wrapTextWithAnsi`):

```ts
type OverlayResult = { action: "send" | "insert"; text: string } | null;

class FollowUpPicker implements Component {
  private selectedIndex = 0;
  constructor(
    private readonly suggestions: readonly string[],
    private readonly theme: Theme,
    private readonly finish: (r: OverlayResult) => void,
  ) {}

  render(width: number): string[] {
    const lines = [
      this.theme.bold("  Follow-up"),
      this.theme.fg("dim", "  ↑↓ move · ⏎ send · ⇧⏎ insert · ⎋ close"),
      "",
    ];
    this.suggestions.forEach((text, i) => {
      const prefix = i === this.selectedIndex ? "→ " : "  ";
      const wrapped = wrapTextWithAnsi(text, Math.max(20, width - 4));
      wrapped.forEach((raw, j) => {
        const line = j === 0 ? `${prefix}${raw}` : `  ${raw}`; // continuation aligns under text
        lines.push(i === this.selectedIndex && j === 0
          ? this.theme.fg("accent", line)
          : (j === 0 ? line : this.theme.fg("dim", line)));
      });
    });
    lines.push("", this.theme.fg("dim", `  ${this.selectedIndex + 1}/${this.suggestions.length}`));
    return lines;
  }

  handleInput(data: string): void {
    const n = this.suggestions.length;
    if (matchesKey(data, "tui.select.up")) this.selectedIndex = (this.selectedIndex + n - 1) % n;
    else if (matchesKey(data, "tui.select.down")) this.selectedIndex = (this.selectedIndex + 1) % n;
    else if (matchesKey(data, "shift+enter")) this.finish({ action: "insert", text: this.suggestions[this.selectedIndex] });
    else if (matchesKey(data, "tui.select.confirm")) this.finish({ action: "send", text: this.suggestions[this.selectedIndex] });
    else if (matchesKey(data, "tui.select.cancel")) this.finish(null);
  }

  invalidate(): void {}
}
```

**`openOverlay`** — stale-generation guard closes the overlay but applies nothing:

```ts
async function openOverlay(ctx: ExtensionContext): Promise<void> {
  const snapshot = suggestions;
  if (!snapshot?.length) return;
  const generationAtOpen = generation;
  const result = await ctx.ui.custom<OverlayResult>(
    (_tui, theme, _kb, done) =>
      new FollowUpPicker(snapshot, theme, (r) => done(generation === generationAtOpen ? r : null)),
    { overlay: true, overlayOptions: { anchor: "center", width: "90%", minWidth: 60, maxHeight: "85%" } },
  );
  if (result?.action === "send") {
    clear(ctx);
    try { pi.sendUserMessage(result.text); } catch { /* late lifecycle */ }
  } else if (result?.action === "insert") {
    ctx.ui.pasteToEditor(result.text);
  }
}
```

Everything else in `registerFollowUp` survives: `clear` (abort + generation bump + widget clear), `session_start`/`input`/`session_shutdown` handlers, the `agent_settled` generation flow (sets `suggestions` instead of `selection`).

### 3. Tests

- `tests/core.test.mjs`: drop `selectSuggestion`/clamp cases; rest unchanged.
- `tests/extension.test.mjs`: teaser line rendering, opener inert with no suggestions, opener calls `ctx.ui.custom` with `overlay: true`, picker `handleInput` maps up/down/enter/shift+enter/esc, stale-generation `done` yields null, send path calls `pi.sendUserMessage` and clears.

### 4. Verification

1. `npm test` (focused) → `npm run check` in the clean worktree.
2. Isolated loader script.
3. `termctrl` TUI smoke: teaser appears after settle, `shift+↑` opens overlay, wrap/indent on long suggestions, esc keeps widget, enter sends.

### Unresolved questions

None.
