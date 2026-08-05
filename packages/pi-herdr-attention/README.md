# @iurysza/pi-herdr-attention

A Pi extension that tells Herdr when Pi is waiting for user attention.

It emits `herdr:blocked` events for interactive Pi tools, permission prompts and
Plannotator goal interviews. The wait clears when the tool or permission
finishes, or when Pi shuts down.

The Plannotator mapping is deliberately narrow: only the blocking
`plannotator setup-goal interview` Bash command is reported. Annotation and
other Plannotator flows are not marked as blocked.

## Install

```bash
pi install npm:@iurysza/pi-herdr-attention
```

Reload Pi after installation with `/reload`.

### Local checkout

From a clone of the `pi-extensions` repository:

```bash
pi install /absolute/path/to/pi-extensions/packages/pi-herdr-attention
```

## Requirements

- Pi
- Node.js 22.19 or newer
- A Herdr integration that consumes `herdr:blocked` events

## License

MIT
