# @iurysza/pi-next-message-suggestions

Suggests likely next user messages after a long Pi response.

## Install

```bash
pi install npm:@iurysza/pi-next-message-suggestions
```

## Defaults

Suggestions trigger after **1,200 visible Unicode characters** in a completed
assistant response. The helper receives the latest **3** user or assistant
messages, ending with that response, and generates **3** suggestions.

It always uses its own helper model by default. It does not use or fall back to
the active chat model:

```text
openai-codex / gpt-5.6-luna / low
```

## Configuration

Use these Pi extension flags when starting Pi:

| Flag | Default | Purpose |
| --- | --- | --- |
| `--next-message-suggestions-threshold` | `1200` | Minimum visible assistant characters. |
| `--next-message-suggestions-recent-messages` | `3` | Recent conversational messages sent to the helper. |
| `--next-message-suggestions-count` | `3` | Suggestions to request and require. |
| `--next-message-suggestions-prompt` | built-in prompt | Helper system prompt. |
| `--next-message-suggestions-provider` | `openai-codex` | Helper provider. |
| `--next-message-suggestions-model` | `gpt-5.6-luna` | Helper model. |
| `--next-message-suggestions-thinking` | `low` | Helper thinking level. |

For example:

```bash
pi --next-message-suggestions-threshold 800 \
  --next-message-suggestions-count 4
```

## Requirements

- Pi 0.80.10 or newer
- Auth for the configured helper provider, normally `/login openai-codex`
- A terminal that reports modified keys for `Shift+Up` and `Shift+Enter`

## License

MIT
