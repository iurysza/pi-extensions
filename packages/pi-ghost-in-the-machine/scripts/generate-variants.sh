#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE="$ROOT/shaders/ghost-in-the-machine.glsl"
VARIANTS="$ROOT/shaders/variants"

mkdir -p "$VARIANTS"

cat > "$VARIANTS/off.glsl" <<'EOF'
// Pass-through variant used when no lifecycle face should be shown.
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    fragColor = texture(iChannel0, fragCoord / iResolution.xy);
}
EOF

generate_variant() {
    local name="$1" state="$2" target tmp
    target="$VARIANTS/$name.glsl"
    tmp="$target.tmp.$$"
    awk -v state="$state" '
        $0 == "const int FORCED_STATE = -1;" {
            print "const int FORCED_STATE = " state ";"
            next
        }
        { print }
    ' "$SOURCE" > "$tmp"
    mv "$tmp" "$target"
}

generate_variant idle 0
generate_variant thinking 1
generate_variant working 2
generate_variant done 3
generate_variant error 4

printf 'generated: off idle thinking working done error\n'
