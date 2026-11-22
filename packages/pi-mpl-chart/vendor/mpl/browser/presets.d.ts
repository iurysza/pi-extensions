/** Traditional journal: serif, boxed axes, inward ticks on all four sides, no grid, a framed
 * legend, ink that survives greyscale printing. */
export declare const paperClassic: {
    readonly 'font.family': 'serif';
    readonly 'font.size': 8;
    readonly 'axes.labelsize': 8;
    readonly 'xtick.labelsize': 7;
    readonly 'ytick.labelsize': 7;
    readonly 'legend.fontsize': 7;
    readonly 'figure.figsize': readonly [3.5, 2.5];
    readonly 'figure.dpi': 300;
    readonly 'figure.subplot.left': 0.15;
    readonly 'figure.subplot.right': 0.96;
    readonly 'figure.subplot.bottom': 0.17;
    readonly 'figure.subplot.top': 0.95;
    readonly 'axes.linewidth': 0.6;
    readonly 'axes.edgecolor': '#000000';
    readonly 'axes.labelcolor': '#000000';
    readonly 'text.color': '#000000';
    readonly 'axes.prop_cycle': readonly ['#8C8C8C', '#4D4D4D', '#000000'];
    readonly 'lines.linewidth': 1;
    readonly 'lines.markersize': 3.5;
    readonly 'lines.markeredgewidth': 0.6;
    readonly 'xtick.direction': 'in';
    readonly 'ytick.direction': 'in';
    readonly 'xtick.top': true;
    readonly 'ytick.right': true;
    readonly 'xtick.major.size': 3;
    readonly 'ytick.major.size': 3;
    readonly 'xtick.major.width': 0.6;
    readonly 'ytick.major.width': 0.6;
    readonly 'xtick.major.pad': 3;
    readonly 'ytick.major.pad': 3;
    readonly 'axes.grid': false;
    readonly 'legend.frameon': true;
    readonly 'legend.fancybox': false;
    readonly 'legend.edgecolor': '#000000';
    readonly 'legend.framealpha': 1;
    readonly 'legend.borderpad': 0.4;
    readonly 'legend.handlelength': 1.8;
};
/** Modern paper: Inter, Okabe–Ito colours (colour-blind safe), open axes, a hairline grid,
 * quiet greys for everything that is not data, an unframed legend. */
export declare const paperModern: {
    readonly 'font.family': 'Inter';
    readonly 'font.size': 8;
    readonly 'axes.labelsize': 8;
    readonly 'xtick.labelsize': 7;
    readonly 'ytick.labelsize': 7;
    readonly 'legend.fontsize': 7;
    readonly 'figure.figsize': readonly [3.5, 2.5];
    readonly 'figure.dpi': 300;
    readonly 'figure.subplot.left': 0.15;
    readonly 'figure.subplot.right': 0.96;
    readonly 'figure.subplot.bottom': 0.17;
    readonly 'figure.subplot.top': 0.95;
    readonly 'axes.linewidth': 0.6;
    readonly 'axes.edgecolor': '#7A7A7A';
    readonly 'axes.labelcolor': '#333333';
    readonly 'text.color': '#1A1A1A';
    readonly 'axes.spines.top': false;
    readonly 'axes.spines.right': false;
    readonly 'axes.prop_cycle': readonly ['#9E9E9E', '#56B4E9', '#D55E00'];
    readonly 'lines.linewidth': 1.4;
    readonly 'lines.markersize': 3;
    readonly 'lines.markeredgewidth': 0;
    readonly 'xtick.direction': 'out';
    readonly 'ytick.direction': 'out';
    readonly 'xtick.major.size': 2.5;
    readonly 'ytick.major.size': 2.5;
    readonly 'xtick.major.width': 0.6;
    readonly 'ytick.major.width': 0.6;
    readonly 'xtick.color': '#7A7A7A';
    readonly 'ytick.color': '#7A7A7A';
    readonly 'xtick.labelcolor': '#4D4D4D';
    readonly 'ytick.labelcolor': '#4D4D4D';
    readonly 'xtick.major.pad': 3;
    readonly 'ytick.major.pad': 3;
    readonly 'axes.grid': true;
    readonly 'axes.grid.axis': 'y';
    readonly 'axes.axisbelow': true;
    readonly 'grid.color': '#E8E8E8';
    readonly 'grid.linewidth': 0.5;
    readonly 'legend.frameon': false;
    readonly 'legend.handlelength': 1.8;
};
/** An rc object: matplotlib rc keys to plain values (pass it as `rc` or inside `style: [...]`). */
export type Preset = Readonly<Record<string, string | number | boolean | readonly (string | number)[]>>;
/** Modern product chart on a light surface. */
export declare const modern: Preset;
/** The same chart on a dark surface: the palette's dark steps, not an inversion. */
export declare const modernDark: Preset;
