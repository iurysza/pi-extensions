# @iurysza/pi-follow-up

Suggests likely follow-up messages after a long Pi response.

## Install

```bash
pi install npm:@iurysza/pi-follow-up
```

## Configuration

The extension creates this user configuration file on first load:

```text
~/.pi/agent/pi-follow-up.json
```

If `PI_CODING_AGENT_DIR` is set, the file goes in that directory instead.

```json
{
  "threshold": 1200,
  "recentMessages": 3,
  "count": 3,
  "prompt": "Suggest the next user message for this conversation. Return exactly the requested number of concise, distinct, natural replies. They may be questions, confirmations, corrections, or useful next tasks. Do not explain your choices. Call the follow_up_suggestions tool and provide only its suggestion strings.",
  "provider": "openai-codex",
  "model": "gpt-5.6-luna",
  "thinking": "low"
}
```

You may omit properties to keep their defaults. Unknown properties and invalid
values stop the extension from loading and name the problem in Pi's extension
error. Pi does not replace an invalid file.

After editing the file, run `/reload` or restart Pi. Run `/follow-up` to see the
active values and configuration path.

| Property | Value | Purpose |
| --- | --- | --- |
| `threshold` | positive integer | Minimum visible assistant characters. |
| `recentMessages` | positive integer | Recent user and assistant messages sent to the helper. |
| `count` | positive integer | Suggestions to request and require. |
| `prompt` | non-empty string | Helper system prompt. |
| `provider` | non-empty string | Helper provider. |
| `model` | non-empty string | Helper model. |
| `thinking` | `minimal`, `low`, `medium`, `high`, `xhigh`, or `max` | Helper thinking level. |

## Behaviour

Only visible text in a completed assistant response counts toward `threshold`.
Assistant thinking, tool calls, tool results, images, and metadata are excluded.
The helper receives the latest conversational messages, ending with the
triggering response.

The helper uses the configured provider and model. It never falls back to the
active chat model. Generation runs asynchronously. Failures and stale results
do not interrupt the session.

Suggestions appear in Pi's supported widget area above the editor. They are not
added to the conversation or sent to the model.

- `Shift+Up` focuses the list.
- `Up` and `Down` select a suggestion and stop at the list boundaries.
- `Enter` sends the selected suggestion.
- `Shift+Enter` inserts it at the editor cursor.
- `Esc` leaves selection while keeping suggestions visible.

Ordinary typing does not hide suggestions. Submitting a user message clears them
and cancels an in-flight helper request.

Terminals must report modified keys. Pi recognises legacy and Kitty `Shift+Up`
sequences, plus Kitty and configured Ghostty `Shift+Enter` sequences.

## Requirements

- Pi 0.80.10 or newer
- Authentication for the configured helper provider, normally `/login openai-codex`
- A terminal that reports modified keys for `Shift+Up` and `Shift+Enter`

## License

MIT
