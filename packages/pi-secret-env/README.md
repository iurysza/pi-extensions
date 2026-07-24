# @iurysza/pi-secret-env

Pi extension that loads shared AI credentials from
`~/.config/ai/secrets.env` while preventing agents from reading the file or
printing loaded values.

It:

- injects loaded values into Pi and user `!` / `!!` commands;
- blocks secret-file paths in shell and file-tool calls;
- blocks direct environment dumps such as `env`, `printenv`, `export -p`, and
  `set`;
- redacts loaded values and `KEY=value` pairs from final text tool results.

Missing or unreadable env files are ignored so normal command execution remains
available. Protected path checks remain fail-closed. The package never ships an
env file or secret fixture.

File format:

```env
KEY=value
OTHER_KEY="quoted value"
# comments allowed
```

Keep the real file mode at `600`. Final-result redaction cannot guarantee that a
streaming or partial renderer never briefly displays output, so do not ask tools
to print credentials.

## Development

```sh
npm run check
npm pack --dry-run
```

Tests use inline fake values only.

## Provenance

Extracted from `agents/pi/agent/extensions/secret-env.ts` at source commit
`cd71561e8ae282c89c44ac1965e96a7cf5db0217`.

## License

MIT
