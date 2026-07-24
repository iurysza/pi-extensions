# Aine – Standalone Code Review Tool

## Vize

Aine je agent-agnostický diff viewer a code review tool. Funguje jako standalone CLI (`npm i -g aine`), bez závislosti na konkrétním AI harnessu. Agenti (Claude Code, Pi, Codex, OpenCode) se integrují přes skill file, který je naučí ovládat běžící aine instanci přes `aine session` CLI příkazy.

**Inspirace:** [diffity](https://github.com/kamranahmedse/diffity), [plannotator](https://github.com/backnotprop/plannotator), [hunk](https://github.com/modem-dev/hunk)

---

## Fáze 1 – Osamostatnění

Cíl: aine funguje jako standalone CLI nástroj, nezávisle na pi.

### 1.1 Standalone CLI balík
- [ ] Vytvořit nový top-level adresář `aine/` (nebo samostatné repo) s vlastním `package.json` (`name: "aine"`, `bin: { aine: "./cli.ts" }`)
- [ ] Přesunout core logiku z `extensions/aine/` – `git.ts`, `server.ts`, `diff-session.ts`, `ssr-worker-client.ts`, `ssr-worker.ts`, `lru-cache.ts`
- [ ] Přesunout frontend (`src/`) a `vite.config.ts`, `svelte.config.js`
- [ ] CLI entry point (`cli.ts`) s plnou command strukturou:
  - `aine` / `aine diff` – working tree changes
  - `aine diff --staged` / `aine diff --watch`
  - `aine show [ref]` – zobrazí commit
  - `aine diff main..feature` – branch comparison
  - `aine --port <port>` / `--no-open` / `--dark` / `--unified`
- [ ] `npm i -g aine` funguje, `aine` spustí server a otevře browser
- [ ] Testy: CLI parsování, git ref validace

### 1.2 Session daemon & remote control API
- [ ] Při startu aine instance se registruje u lokálního session store (soubor v `~/.config/aine/sessions/` nebo lightweight loopback HTTP daemon)
- [ ] Každá session má: `id`, `repo`, `port`, `pid`, `startedAt`, `diffArgs`
- [ ] `aine session` subcommands:
  - `aine session list [--json]` – výpis běžících instancí
  - `aine session context --repo .` – vrátí aktuální stav (repo, branch, soubory, vybraný soubor, diff args)
  - `aine session navigate --repo . --file <path> [--hunk N | --line N]` – přesune focus v UI
  - `aine session reload --repo . [-- diff --staged]` – swap obsahu bez restartu
  - `aine session comment add --repo . --file <path> --line <N> --summary "..." [--severity must-fix|suggestion|nit] [--author agent]`
  - `aine session comment list --repo . [--file <path>] [--json]`
  - `aine session comment resolve --repo . <id>`
  - `aine session comment rm --repo . <id>`
  - `aine session comment clear --repo . [--file <path>] --yes`
- [ ] Session commands komunikují s běžící instancí přes HTTP API (`/api/session/*`)
- [ ] Auto-cleanup: při ukončení aine procesu se session odregistruje

### 1.3 Skill file pro agenty
- [ ] Vytvořit `skills/aine-review/SKILL.md` – naučí agenta workflow:
  1. `aine session list` → najdi živou session
  2. `aine session context --repo .` → zjisti co se reviewuje
  3. `aine session navigate ...` → naviguj na zajímavé místo
  4. `aine session comment add ...` → zanech komentář
  5. Opakuj pro všechny findings
- [ ] Skill je agent-agnostický – funguje v Claude Code, Pi, Codex, OpenCode
- [ ] Dokumentovat typické prompty: "review my changes", "leave comments on the diff"

### 1.4 Pi extension jako tenký wrapper
- [ ] Zredukovat `extensions/aine/index.ts` na:
  - `/aine [args]` → spustí `aine` CLI jako subprocess
  - `/aine-review` → spustí `aine` + zavolá review workflow přes session API
  - `/aine-resolve` → přečte komentáře přes `aine session comment list`, provede změny
- [ ] Extension závisí na globálně nainstalovaném `aine` (s fallbackem na `npx aine`)
- [ ] `pi.on("session_shutdown")` → uklidí aine process

---

## Fáze 2 – Review Core

Cíl: kompletní review loop – komentáře, resolve, AI review.

### 2.1 Inline komentáře v UI
- [ ] Backend: `DiffSession` drží komentáře in-memory (`Map<string, Comment[]>`)
  - `Comment: { id, file, line, side, summary, severity?, author, createdAt, resolved }`
- [ ] API endpointy:
  - `GET /api/comments[?file=...]` – seznam komentářů
  - `POST /api/comments` – přidání komentáře
  - `PATCH /api/comments/:id` – resolve/unresolve
  - `DELETE /api/comments/:id` – smazání
- [ ] SSE stream `/api/comments/stream` – live updates (agent přidá komentář → UI se updatne)
- [ ] Frontend: kliknutí na číslo řádku v diff view → otevře inline textarea
- [ ] Zobrazení komentářů jako inline bubliny pod příslušným řádkem
- [ ] Severity color coding: `must-fix` (červená), `suggestion` (žlutá), `nit` (šedá)
- [ ] Keyboard: `c` otevře komentář na aktuálním řádku, `Ctrl+Enter` odešle

### 2.2 Komentáře v sidebar
- [ ] Badge u každého souboru: počet neresolved komentářů
- [ ] Highest severity indikátor (červená/žlutá/šedá tečka)
- [ ] Filter: "show files with comments only"
- [ ] Resolved komentáře: šedé, collapsed, toggle "show resolved"

### 2.3 Agent review přes session API
- [ ] `aine session comment add` zapisuje komentáře do běžící instance → UI se updatne přes SSE
- [ ] `aine session comment list --json` vrací strukturovaný výstup pro agenta
- [ ] Agent context JSON import: `aine diff --agent-context notes.json`
  - Formát: `[{ file, line, summary, severity?, rationale? }]`

### 2.4 Resolve workflow
- [ ] UI: tlačítko "Resolve" na každém komentáři → PATCH `/api/comments/:id`
- [ ] `aine session comment resolve <id>` – agent může resolvnout po provedení opravy
- [ ] Bulk resolve: "Resolve all in file" / "Resolve all"

---

## Fáze 3 – Polish & rozšířené funkce

### 3.1 Watch mode
- [ ] `aine --watch` / `aine diff --watch` – `fs.watch` na working tree
- [ ] Debounced refresh (300ms), zachování scroll pozice a vybraného souboru
- [ ] SSE notifikace do UI při změně

### 3.2 Diff type switcher v UI
- [ ] Toolbar dropdown/toggle: Uncommitted / Staged / Unstaged / Last commit / Branch
- [ ] Přepnutí → `session.reload(newDiffArgs)` → refresh bez restartu serveru
- [ ] Odpovídá `aine session reload` z CLI

### 3.3 Multi-instance
- [ ] Auto-assign portů z rozsahu (5491, 5492, ...)
- [ ] `aine session list` zobrazí všechny instance
- [ ] Detekce existující instance pro stejný repo → otevře existující místo nové
- [ ] `aine --new` – kill existující a start nový

### 3.4 Config file
- [ ] `~/.config/aine/config.toml`:
  ```toml
  theme = "catppuccin"    # catppuccin, github-dark, ...
  mode = "split"          # split, unified
  port_range = [5491, 5500]
  watch = false
  open_browser = true
  ```
- [ ] CLI flags overridují config
- [ ] Per-repo config: `.aine/config.toml`

### 3.5 Git integrace
- [ ] `aine pager` mode – funguje jako `git config core.pager "aine pager"`
- [ ] `aine difftool` – `git config diff.tool aine`
- [ ] Patch input: `git diff | aine patch -`

### 3.6 GitHub PR review
- [ ] `aine pr https://github.com/.../pull/123`
- [ ] Vyžaduje `gh` CLI
- [ ] Stáhne PR diff, zobrazí v aine
- [ ] Push komentářů zpět na GitHub jako PR review comments

---

## Rozhodnutí k diskusi

1. **Mono-repo vs. samostatné repo** – zůstane aine v `pi-ext` nebo nové repo?
2. **Runtime** – zůstat na Bun, nebo přejít na Node.js pro širší kompatibilitu?
3. **Název balíku** – `aine` na npm (je volný?)
4. **Licence** – MIT vs. jiná
5. **Session store** – soubory v `~/.config/aine/sessions/` (jednodušší) vs. loopback daemon (jako hunk)?
