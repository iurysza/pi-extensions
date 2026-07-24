# @iurysza/pi-context-audit

Pi extension that measures the current system prompt, active and available tool
schemas, context files, skills, MCP cache, context usage, and the last captured
provider payload.

Run:

```text
/context-audit [md|json] [open] [copy]
```

Audits are written under Pi's agent cache directory. Markdown and JSON audit
generation are portable. The optional `open` and `copy` actions call macOS
`open` and `pbcopy`, respectively.

The extension records size metadata and serialized schemas; review generated
audits before sharing because provider payload summaries may describe the
current session.

## Development

```sh
npm run check
npm pack --dry-run
```

## Provenance

Extracted from
`agents/pi/agent/extensions/context-audit.ts` at source commit
`8651d8d73928f96e29d4618e3aace772aef5cbc6`.

## License

MIT
