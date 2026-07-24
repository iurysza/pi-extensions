# GitHub Copilot quota adapter design

## Goal

Show GitHub Copilot individual quota when the active Pi model provider is `github-copilot`, without changing Codex or Kimi behavior. Cursor remains unsupported until Pi has a provider and Cursor exposes a safe official individual quota API.

## Data flow

`src/providers.ts` routes `github-copilot` models to a new Copilot adapter. The adapter reads Pi's stored OAuth credential through the existing public read-only credential seam and callback-scopes its `refresh` token to one GET of `https://api.github.com/copilot_internal/user`. It never logs, returns, refreshes, mutates, caches, or persists the token or raw response. Normalized quota intentionally uses the coordinator's existing in-memory five-minute/stale cache and is never persisted.

The paid parser prefers `quota_snapshots.premium_interactions`, then finite `chat` or `completions` snapshots. It prefers `quota_remaining` over `remaining`, uses finite `percent_remaining` for the percentage, and otherwise derives percentage from counts. Free responses without snapshots pair `monthly_quotas` limits with `limited_user_quotas` remaining, preferring chat then completions. Values are clamped to 0–100% and normalized to at most one decimal. Per-snapshot `quota_reset_at` takes precedence over top-level UTC/date resets; Free uses `limited_user_reset_date`. Unlimited, unavailable, placeholder, or organization-managed snapshots without a finite individual quota produce a live empty result rather than an invented limit.

## Failure and security behavior

Missing, non-OAuth, or blank credentials produce the normal missing state and `/login github-copilot` guidance. Stored custom GitHub Enterprise Server domains produce a fixed unsupported state before any network call; GitHub Enterprise Cloud seats hosted on GitHub.com remain supported. The request rejects redirects and applies one ten-second timeout through response-body parsing. HTTP errors expose only status codes; malformed schemas expose fixed parser errors; arbitrary network errors collapse to a generic message. Response bodies and credential values never appear in errors.

The GitHub.com endpoint is undocumented and may change. This is an explicitly approved narrow exception to Token Tank's metadata-only stored-credential rule because Pi's model registry exposes only the short-lived Copilot session token, while the quota endpoint requires the original GitHub OAuth token.

## Validation

Unit tests cover credential immutability, current and alternate response fields, percentage fallback, clamping, reset variants, free-plan fallback, unlimited quotas, malformed bodies, routing, widget visibility, and secret-safe failures. Release checks are `npm run check`, `npm test`, `npm pack --dry-run`, plus the official isolated Pi extension loader when feasible without credentials.
