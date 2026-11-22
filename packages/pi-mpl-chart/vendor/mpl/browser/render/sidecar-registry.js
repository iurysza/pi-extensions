// The annotated-SVG sidecar writer is opt-in code: Figure reaches it only through this registry, so a bundle that never
// imports mpl/annotate leaves src/render/annotate.ts out (like faces and colormaps, which register the same way).
                                                   
                                                         
import { none, some } from '../core/types.js';

/** Writes one Axes' sidecar (XML-escaped JSON) with pixel points at `dp` decimals, for a figure at `dpi`; mpl/annotate exports the one mpl ships. */
                                                                                             

let writer                        = none;

/** Enable fig.toSVG({ interactive: true }): `import { sidecar } from 'mpl/annotate'; registerSidecar(sidecar);` */
export function registerSidecar(w               )       { writer = some(w); }

/** The registered writer; throws, naming the import, when there is none. */
export function sidecarWriter()                {
  if (writer.kind === 'some') return writer.value;
  throw new Error("toSVG({ interactive: true }) needs the sidecar writer, which is not bundled by default:\n"
    + "  import { registerSidecar } from 'mpl';\n  import { sidecar } from 'mpl/annotate';\n  registerSidecar(sidecar);");
}
