import type { AxesAnnot } from '../core/layout.js';
import type { AxesSpec } from '../core/types.js';
/** Writes one Axes' sidecar (XML-escaped JSON) with pixel points at `dp` decimals, for a figure at `dpi`; mpl/annotate exports the one mpl ships. */
export type SidecarWriter = (ax: AxesSpec, an: AxesAnnot, dp: number, dpi: number) => string;
/** Enable fig.toSVG({ interactive: true }): `import { sidecar } from 'mpl/annotate'; registerSidecar(sidecar);` */
export declare function registerSidecar(w: SidecarWriter): void;
/** The registered writer; throws, naming the import, when there is none. */
export declare function sidecarWriter(): SidecarWriter;
