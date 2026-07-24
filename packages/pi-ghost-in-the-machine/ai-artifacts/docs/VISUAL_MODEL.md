# Visual Model

> The shader contract: variants, placement, and visual invariants.

## 1. Variant model

```mermaid
flowchart LR
    Source[One source shader] --> Generate[Generate variants]
    Generate --> I[idle]
    Generate --> T[thinking]
    Generate --> W[working]
    Generate --> D[done]
    Generate --> E[error]
    I & T & W & D & E --> Selected[Exactly one selected path]
    Selected --> Ghostty
```

Variants differ only by `FORCED_STATE`. Change the source, regenerate every variant, and commit them together:

```sh
npm run generate
```

`off` normally removes `custom-shader`; it is not another animated state.

## 2. Placement

The face keeps one height-based size and one `16 px × 29` sidebar-center placement on every display. Its full animated footprint may move right only when needed to retain a `0.1%` viewport-width gap at the left edge; it never shrinks or switches layout based on cursor geometry. The face always renders on the dense `8 × 17 px` virtual ASCII grid.

## 3. Visual invariants

- Ghostty coordinates are top-down in the tested renderer.
- Shared breathing, drift, gaze, and blink make every state one creature.
- State-specific color and decorations carry the quick read: yellow/question, blue/effort, green/sparkles, red/worry.
- `iFocus == 0` returns the untouched terminal texture.
- Herdr visibility belongs in the controller, never GLSL.

Read [`Architecture`](../ARCHITECTURE.md) before changing control/render boundaries. Read [`Lifecycle`](./lifecycle.md) before changing what a state means.
