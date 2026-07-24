# pi-context-audit

See where Pi's context goes. Context Audit measures the active system prompt,
tool schemas, context files, skills, MCP cache, context usage, and the last
captured provider payload.

## Install

```bash
pi install npm:@iurysza/pi-context-audit
```

Restart Pi or run `/reload` after installation.

## Run an audit

```text
/context-audit [md|json] [open] [copy]
```

Audits are written to Pi's agent cache directory. `md` and `json` choose the
output format; `open` and `copy` use macOS `open` and `pbcopy` when available.

## What it captures

- System prompt and context-file size
- Active and available tool schemas
- Skills, commands, and MCP cache metadata
- Context-window usage
- Size metadata for the latest captured provider payload

Audits contain serialized schemas and may summarize the current session. Review
them before sharing.

## Requirements

- Pi
- Node.js 22.19 or newer
- macOS only for `open` and `copy`

## License

MIT