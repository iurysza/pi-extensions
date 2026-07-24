# pi-secret-env

Load shared credentials into Pi without handing the agent an easy way to read
or print them. Secret Env reads a local env file, injects its values into Pi and
user shell commands, then blocks direct access and redacts final tool output.

## Install

```bash
pi install npm:@iurysza/pi-secret-env
```

Restart Pi or run `/reload` after installation.

## Setup

Create `~/.config/ai/secrets.env` with mode `600`:

```env
OPENAI_API_KEY="..."
OTHER_KEY=value
# comments are allowed
```

The extension accepts normal `KEY=value` entries and quoted values. A missing
or unreadable file changes nothing: Pi continues normally.

## Protection

Secret Env:

- blocks reads of the configured secret file through shell and file tools;
- blocks direct environment dumps such as `env`, `printenv`, `export -p`, and
  `set`;
- redacts loaded values and `KEY=value` pairs from final text tool results; and
- makes loaded values available to Pi and user `!` or `!!` commands.

This is a guardrail, not a sandbox. Streaming or partial renderers can expose
output before final-result redaction runs. Never ask a tool to print a
credential, and do not put secrets in project files or command-line arguments.

## Requirements

- Pi
- Node.js 22.19 or newer

## License

MIT