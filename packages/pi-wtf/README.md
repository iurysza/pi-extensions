# @iurysza/pi-wtf

A small Pi extension for preserving repeated or systemic workflow friction in the current workspace.

## Tool

### `wtf`

Accepts one required `note` and writes one Markdown artifact per call:

```text
ai-artifacts/wtf/YYYY-MM-DD-note-slug.md
```

Each artifact contains the note under a `# WTF` heading. Same-day duplicate slugs receive a numeric suffix rather than overwriting the earlier note.

Use it for recurring process or tooling problems worth fixing. Do not use it for one-off failures, status updates, or general notes.

## Install

From npm:

```bash
pi install npm:@iurysza/pi-wtf@0.1.0
```

For local development:

```bash
pi install /absolute/path/to/pi-extensions/packages/pi-wtf
```

Reload Pi after installation with `/reload`.
