# Pi Extensions

Private workspace and public Git bundle for Pi extensions maintained by Iury
Souza. The root package is never published. It exposes one explicit Pi resource
catalog while each child package remains independently publishable as
`@iurysza/*`.

## Status

Phase 2 bootstrap. The workspace has no imported packages yet, so Git
installation is not supported until the package imports and installation checks
are complete.

Planned packages:

- `@iurysza/pi-ext` — attributed fork of `tomsej/pi-ext`
- `@iurysza/pi-context-audit`
- `@iurysza/pi-agent-explorer`
- `@iurysza/pi-token-tank`
- `@iurysza/pi-tmux-title`
- `@iurysza/pi-secret-env`

The root `pi.extensions`, `pi.skills`, and `pi.themes` fields deliberately list
the prefixed union of all child manifests. Pi does not recursively discover
workspace manifests.

## Development

```sh
npm ci
npm run check
```

`check-catalog` protects the private root and validates the bootstrap resource
catalog. `check-packs` dry-runs every publishable workspace tarball. Both become
stricter as packages land; no child lockfile is allowed.

## Source snapshots before bootstrap

| Source | Branch / SHA | State |
| --- | --- | --- |
| `pi-ext` | `main` / `08d03577f0be043c1fc5f4bd169d8d9550b5a2b8` | clean, Phase 1 merged |
| `pi-agent-explorer` | `main` / `139de6ef2eccf900edef968d5fe156de1cd9e369` | clean |
| `pi-token-tank` | `main` / `70b61502de8dd8440cf8dcef948f84a0f3235ba9` | clean |
| `agents` | `main` / `5bb5aa42dbf020287ba2e78b0b5e8c03aba58e01` | dirty and behind remote; not touched |

The three source repositories will be imported with `git subtree`, preserving
history. Never use Git submodules. The original repositories and local agent
extensions remain untouched until later migration phases prove parity.

## Licensing and provenance

The root [LICENSE](LICENSE) covers only Iury-owned packages. `packages/pi-ext`
is excluded from that ownership claim: it retains its own MIT license, component
licenses, and [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) obligations.
See the root [third-party notices](THIRD_PARTY_NOTICES.md) for the boundary.
