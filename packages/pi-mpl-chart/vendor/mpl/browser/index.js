// Default entry: same API as mpl/core, plus matplotlib's default face and colormap registered
// so `import { subplots } from 'mpl'` renders with no register calls. For Workers / lean bundles
// that pay only for the assets they use, import from 'mpl/core' instead and register explicitly.
export * from './core.js';

import { registerColormapRgba, registerColormaps, registerFonts } from './core.js';
import { dejavuSans } from './fonts/dejavu-sans.js';
import { viridis, viridis_r } from './colormaps/viridis.js';
import { viridis_rgba } from './colormaps/viridis.rgba.js';

registerFonts(dejavuSans);
registerColormaps(viridis, viridis_r);
registerColormapRgba(viridis_rgba);
