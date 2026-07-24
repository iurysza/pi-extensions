# artifact-explorer

Open each repository's `ai-artifacts/` directory as an isolated Obsidian vault
with a shared workspace layout. Artifact Explorer keeps project artifacts
separate while reusing the plugins and settings from your main vault.

## Install

```bash
pi install npm:@iurysza/artifact-explorer
```

Create the machine-local configuration:

```bash
agent_dir="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
mkdir -p "$agent_dir/artifact-explorer"
cp "$agent_dir/npm/node_modules/@iurysza/artifact-explorer/config.json.example" \
  "$agent_dir/artifact-explorer/config.json"
```

Edit `sourceProfilePath` to the **absolute path** of your main vault's
`.obsidian` directory, then restart Pi or run `/reload`.

```json
{
  "sourceProfilePath": "/absolute/path/to/main-vault/.obsidian",
  "obsidianBinary": "obsidian",
  "artifactWorkspaceName": "AI Artifacts",
  "hubWorkspaceName": "Artifact Hub"
}
```

## Commands

| Command | Description |
| --- | --- |
| `/artifact-explorer` | Create or open the current repository's artifact vault. |
| `/artifact-explorer hub` | Open the metadata-only hub of known projects. |
| `/artifact-explorer status` | Show detected paths, CLI availability, and vault registration. |
| `/artifact-explorer --help` | Show command help. |

## What it does

- Finds the Git root from Pi's current working directory.
- Creates `<git-root>/ai-artifacts/` when missing.
- Copies plugins and settings from the configured source profile.
- Preserves each artifact vault's own workspace tabs and layout.
- Registers and opens the artifact vault in a separate Obsidian window.
- Installs Vault Nickname when needed and labels the vault
  `<project> · AI Artifacts`.
- Tracks project metadata in the Pi agent directory.
- Opens a metadata-only hub for navigating known artifact vaults.

Each repository receives this local Git exclusion:

```gitignore
/ai-artifacts/.obsidian/
```

Only `.git/info/exclude` changes; project `.gitignore` files remain untouched.
The runtime registry, hub, and machine-local configuration stay under
`${PI_CODING_AGENT_DIR:-~/.pi/agent}/artifact-explorer/` and are never shipped
with the package.

## Requirements

- Pi
- Node.js 22.19 or newer
- macOS
- Obsidian with its CLI enabled under Settings → General → Advanced

The extension copies the configured Obsidian profile into artifact vaults.
Review that profile before using it if plugin data contains machine-local or
sensitive settings.

## License

MIT