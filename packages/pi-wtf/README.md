# @iurysza/pi-wtf

A small Pi extension for preserving repeated or systemic workflow friction in the current workspace.

## Tool

### `wtf`

Accepts one required `note` and appends it under an ISO timestamp in `WTF.md`. The first write creates the file with a `# WTF` heading.

Use it for recurring process or tooling problems worth fixing. Do not use it for one-off failures, status updates, or general notes.

## Install

```bash
pi install npm:@iurysza/pi-wtf
```

Reload Pi after installation with `/reload`.

### Local checkout

From a clone of the `pi-extensions` repository:

```bash
pi install /absolute/path/to/pi-extensions/packages/pi-wtf
```
