# Agent Notes

Provider-neutral Pi quota extension. Keep the README user-facing.

Before changing provider contracts, routing, caching, or adding a provider, read [[ai-artifacts/MOC]] and [ai-artifacts/provider-adapters.md](ai-artifacts/provider-adapters.md).

Rules:

- Use direct read-only quota endpoints.
- Resolve keys through `ctx.modelRegistry`; use exported `readStoredCredential` only for read-only metadata, except for the explicitly approved callback-scoped Copilot OAuth `refresh` read documented in `ai-artifacts/provider-adapters.md`.
- Cursor is the second explicit exception: detect provider id `cursor` only through Pi ModelRegistry. Capture an explicitly supplied `CURSOR_SESSION_TOKEN` when the extension registers, delete it from `process.env` before Pi tools run, and keep it only in process memory so extension reloads retain auth. Never discover browser cookies or read Cursor Desktop/Agent auth databases.
- Never persist credentials, raw responses, or normalized quota. The coordinator may cache normalized quota in memory for five minutes and stale fallback.
- Keep provider-specific auth and parsing inside its adapter/fetcher.
- Run `npm run check`, `npm test`, and `npm pack --dry-run` before shipping.
