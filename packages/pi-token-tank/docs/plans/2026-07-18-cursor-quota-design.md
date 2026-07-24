# Cursor quota design

## Goal

Show truthful Cursor personal and Enterprise quota only when a Pi extension registers provider id `cursor`. Keep Token Tank standalone and leave behavior unchanged when Cursor is absent.

## Detection

At runtime, build the provider registry from Pi's public ModelRegistry. Add Cursor when `getRegisteredProviderIds()` includes `cursor` or the active model provider is `cursor`. This matches `pi-cursor-sdk`, which calls `pi.registerProvider("cursor", ...)`, without importing or depending on that package.

Provider registration proves availability, not authentication or quota. The `pi-cursor-sdk-cursor-api-key-placeholder` sentinel must never count as configured quota auth.

## Data and authentication

Cursor exposes no official personal quota API. The signed-in dashboard uses the private read-only endpoint:

```text
GET https://cursor.com/api/usage-summary
```

The user explicitly approved this private-dashboard path. Token Tank accepts only an explicitly supplied `CURSOR_SESSION_TOKEN`, representing the value of the `WorkosCursorSessionToken` cookie. It captures the value when the extension registers, moves it into a process-only non-environment slot that survives extension reloads, and immediately deletes it from `process.env`, preventing Pi tools and child processes from inheriting it. It does not inspect browser cookie stores, Cursor Desktop/Agent databases, Pi credential files, or subprocess output. The captured token is validated against cookie-header injection and is never refreshed, logged, or persisted.

Cursor's SDK API key is a separate credential and cannot authenticate the dashboard endpoint.

## Normalization

Use Cursor's dashboard values in this order:

1. `individualUsage.plan.totalPercentUsed`
2. finite `individualUsage.plan.used / limit`
3. finite Enterprise `individualUsage.overall.used / limit`
4. finite Enterprise `teamUsage.pooled.used / limit`

The primary window is the billing-cycle total. Optional `autoPercentUsed` and `apiPercentUsed` become detail windows. `billingCycleEnd` supplies the reset timestamp. Missing finite quota data is an error; registration or unlimited data never becomes a fabricated `0%` quota.

## Failure behavior

- Cursor absent: no provider, request, widget row, or footer change.
- Cursor detected without a session token: missing state and setup guidance.
- Session rejected with 401/403: missing state.
- Other HTTP, timeout, redirect, or schema failures: sanitized error state.
- A previous live result may remain as stale through the existing process-memory coordinator cache.

Raw response bodies and credentials never enter errors or persistence.

## Testing

- Personal, Enterprise personal-cap, and pooled response fixtures.
- Cookie construction, injection rejection, timeout lifetime, and error redaction tests.
- Mocked ModelRegistry tests for absent, registered, active-model, and registration-before-model-selection lifecycles.
- Official Pi `discoverAndLoadExtensions()` package-loader smoke.
- Existing Codex, Kimi, and Copilot suites remain unchanged.

## Sources

- [`pi-cursor-sdk` provider registration](https://github.com/fitchmultz/pi-cursor-sdk/blob/main/src/index.ts)
- [Cursor TypeScript SDK authentication](https://cursor.com/docs/sdk/typescript)
- [CodexBar Cursor provider notes](https://github.com/steipete/CodexBar/blob/main/docs/cursor.md)
- [CodexBar Cursor parser and Enterprise fixtures](https://github.com/steipete/CodexBar/tree/main/Sources/CodexBarCore/Providers/Cursor)
