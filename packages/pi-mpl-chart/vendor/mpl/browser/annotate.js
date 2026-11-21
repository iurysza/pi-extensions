// mpl/annotate: the annotated-SVG sidecar writer, kept out of the default bundles. Pass it to registerSidecar() to
// enable fig.toSVG({ interactive: true }); the browser side is mpl/interactive.
import { axesSidecar } from './render/annotate.js';
                                                                  

export const sidecar                = axesSidecar;
export { decimate, MAX_POINTS } from './render/annotate.js';
