# Pi Extensions

Private workspace and public Git bundle for Pi extensions maintained by Iury
Souza. The root package is never published. It exposes one explicit Pi resource
catalog while each child package remains independently publishable as
`@iurysza/*`.

## Status

All six packages are present. The three former standalone repositories retain
unsquashed subtree history; the three local extensions were copied from clean,
committed source files. Git installation remains unadvertised until isolated
installation validation is complete.

Packages:

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

`check-catalog` validates the private root, child metadata, resource union,
source namespaces, paths, and the single-lockfile rule. `check-packs` performs a
read-only dry run of every publishable tarball and rejects development leakage.

## Upstream synchronization

The first `pi-ext` subtree import came from `iurysza/pi-ext`. Future source syncs
come from `tomsej/pi-ext`:

```sh
scripts/sync-pi-ext.sh
```

The script must run from a clean repository root, pulls without `--squash`, and
then runs catalog, legal, install, typecheck, test, and pack checks. Merge
conflicts are deliberately left visible for human resolution.

## Imported sources

| Package | Source | Imported SHA |
| --- | --- | --- |
| `pi-ext` | `https://github.com/iurysza/pi-ext` `main` | `08d03577f0be043c1fc5f4bd169d8d9550b5a2b8` |
| `pi-agent-explorer` | `https://github.com/iurysza/pi-agent-explorer` `main` | `139de6ef2eccf900edef968d5fe156de1cd9e369` |
| `pi-token-tank` | `https://github.com/iurysza/pi-token-tank` `main` | `1f7b4977f3bae45272aba4a2d74aabdd889cee37` |

Token Tank's recorded local source was clean at `70b6150`; GitHub `main` had two
new descendant commits. The newer `1f7b497` snapshot was explicitly approved
for import.

The repositories were imported with `git subtree` without `--squash`. Never use
Git submodules. Future `pi-ext` source synchronization comes from
`https://github.com/tomsej/pi-ext`.

## Extracted sources

| Package | Source path | Source commit |
| --- | --- | --- |
| `pi-context-audit` | `agents/pi/agent/extensions/context-audit.ts` | `8651d8d73928f96e29d4618e3aace772aef5cbc6` |
| `pi-tmux-title` | `agents/pi/agent/extensions/pi-tmux-kebab-title.ts` | `466f46ae1834a0ad66c4909186494d31b9a8dbdd` |
| `pi-secret-env` | `agents/pi/agent/extensions/secret-env.ts` | `cd71561e8ae282c89c44ac1965e96a7cf5db0217` |

The dirty, behind-remote `agents` repository was not modified. Original local
extensions and all old repositories remain available until migration parity is
proven.

## Licensing and provenance

The root [LICENSE](LICENSE) covers only Iury-owned packages. `packages/pi-ext`
is excluded from that ownership claim: it retains its own MIT license, component
licenses, and [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) obligations.
See the root [third-party notices](THIRD_PARTY_NOTICES.md) for the boundary.
