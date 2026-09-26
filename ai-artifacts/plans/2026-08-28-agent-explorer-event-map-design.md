# Agent Explorer event map

## Problem

Agent Explorer currently infers extensions from registered tools and commands. Extensions that only subscribe to Pi events are absent, and there is no event-centred view of runtime behaviour.

Pi's public extension API exposes tools and commands but not loaded extension records or handler ownership. The internal loader has that information, but Agent Explorer should not depend on private runtime objects.

## Intended outcome

Add a source-derived map of the event hooks declared by loaded extensions:

```text
Events/
  README.md
  session_start.md
  tool_call.md

Extensions/<extension>/
  README.md
  TOOLS.md
  EVENTS.md
```

Event pages list subscribing extensions and handler source locations. Extension pages link back to their events. Extensions with event hooks but no tools or commands still appear under `Extensions/`.

## Chosen approach

Discover extension entry points from:

1. resolved package selections in user and trusted project settings;
2. provenance attached to registered tools and commands;
3. user and trusted project auto-discovery directories;
4. package manifests when no resolved package selection owns the source;
5. explicit CLI extension arguments.

Pi's public `DefaultPackageManager` resolves package filters, project overrides, and top-level auto-discovery without loading extension factories. Disabled resources stay out of the snapshot. For each entry point, traverse local relative imports within its nearest package boundary. Detect literal `pi.on("event", ...)` registrations and record the event, source path, and line.

This matches the current repository: all production Pi event registrations use literal event names. It avoids re-executing extension factories and avoids private Pi internals.

## Rejected alternatives

### Re-execute extension factories

Pi's loader can return exact handler maps, but loading extensions a second time may duplicate startup side effects, process listeners, or provider registration.

### Depend on Pi internals

The internal `Extension.handlers` map is accurate but is not available through `ExtensionAPI`. Reaching into private runner state would be brittle.

### Add hand-maintained event manifests

Explicit metadata could describe intent, but it would drift and would not cover third-party or local extensions automatically.

## Behaviour

- `Events/README.md` lists observed event names with handler and extension counts.
- `Events/<event>.md` links each subscribing extension and exact source location.
- `Extensions/<extension>/EVENTS.md` links each event and exact source location.
- `Extensions/<extension>/README.md` shows an event count.
- The root snapshot README reports total event subscriptions and distinct events.
- The snapshot states that the map is source-derived and only covers literal `pi.on(...)` registrations reachable from discovered entry points.
- Agent Explorer does not guess or generate prose about what arbitrary handler code does. The source link is the authority.

## Constraints and assumptions

- Only local relative imports are traversed. Package dependencies are separate extension boundaries.
- Dynamic event names and aliased `ExtensionAPI` variables are not inferred.
- Snapshot files remain read-only.
- No new runtime dependency is required.

## Verification

- Test an extension with tools, commands, and multiple event hooks.
- Test an event-only extension appears and cross-links correctly.
- Test package-manifest expansion discovers sibling event-only entry points.
- Test comments and string literals do not create false hooks.
- Run the Agent Explorer package test, typecheck, and full monorepo check.

## Unresolved questions

None.
