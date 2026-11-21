// Publication presets: plain matplotlib rc dictionaries. The same plotting code renders as a
// traditional journal figure or a modern paper figure by swapping one of these into
// subplots({ rc }); matplotlib accepts them unchanged (rcParams.update / rc_context).
//
// Both are sized for a single column (3.5 in at 300 dpi) and give series identity through
// colour order: C0 and C1 are baselines, C2 is the result the paper is about.

/** Traditional journal: serif, boxed axes, inward ticks on all four sides, no grid, a framed
 * legend, ink that survives greyscale printing. */
export const paperClassic = {
  'font.family': 'serif', 'font.size': 8,
  'axes.labelsize': 8, 'xtick.labelsize': 7, 'ytick.labelsize': 7, 'legend.fontsize': 7,
  'figure.figsize': [3.5, 2.5], 'figure.dpi': 300,
  'figure.subplot.left': 0.15, 'figure.subplot.right': 0.96, 'figure.subplot.bottom': 0.17, 'figure.subplot.top': 0.95,
  'axes.linewidth': 0.6, 'axes.edgecolor': '#000000', 'axes.labelcolor': '#000000', 'text.color': '#000000',
  'axes.prop_cycle': ['#8C8C8C', '#4D4D4D', '#000000'],
  'lines.linewidth': 1.0, 'lines.markersize': 3.5, 'lines.markeredgewidth': 0.6,
  'xtick.direction': 'in', 'ytick.direction': 'in', 'xtick.top': true, 'ytick.right': true,
  'xtick.major.size': 3, 'ytick.major.size': 3, 'xtick.major.width': 0.6, 'ytick.major.width': 0.6,
  'xtick.major.pad': 3, 'ytick.major.pad': 3,
  'axes.grid': false,
  'legend.frameon': true, 'legend.fancybox': false, 'legend.edgecolor': '#000000', 'legend.framealpha': 1,
  'legend.borderpad': 0.4, 'legend.handlelength': 1.8,
}         ;

/** Modern paper: Inter, Okabe–Ito colours (colour-blind safe), open axes, a hairline grid,
 * quiet greys for everything that is not data, an unframed legend. */
export const paperModern = {
  'font.family': 'Inter', 'font.size': 8,
  'axes.labelsize': 8, 'xtick.labelsize': 7, 'ytick.labelsize': 7, 'legend.fontsize': 7,
  'figure.figsize': [3.5, 2.5], 'figure.dpi': 300,
  'figure.subplot.left': 0.15, 'figure.subplot.right': 0.96, 'figure.subplot.bottom': 0.17, 'figure.subplot.top': 0.95,
  'axes.linewidth': 0.6, 'axes.edgecolor': '#7A7A7A', 'axes.labelcolor': '#333333', 'text.color': '#1A1A1A',
  'axes.spines.top': false, 'axes.spines.right': false,
  'axes.prop_cycle': ['#9E9E9E', '#56B4E9', '#D55E00'],
  'lines.linewidth': 1.4, 'lines.markersize': 3, 'lines.markeredgewidth': 0,
  'xtick.direction': 'out', 'ytick.direction': 'out', 'xtick.major.size': 2.5, 'ytick.major.size': 2.5,
  'xtick.major.width': 0.6, 'ytick.major.width': 0.6, 'xtick.color': '#7A7A7A', 'ytick.color': '#7A7A7A',
  'xtick.labelcolor': '#4D4D4D', 'ytick.labelcolor': '#4D4D4D', 'xtick.major.pad': 3, 'ytick.major.pad': 3,
  'axes.grid': true, 'axes.grid.axis': 'y', 'axes.axisbelow': true, 'grid.color': '#E8E8E8', 'grid.linewidth': 0.5,
  'legend.frameon': false, 'legend.handlelength': 1.8,
}         ;

// ------------------------------------------------------------------ modern product charts
// Validated categorical palette (8 hues, separate light and dark steps; adjacent-pair CVD ΔE ≥ 8.4,
// normal-vision ΔE ≥ 19.3 in both modes). Ink and surfaces are tokens, so a chart's code names
// roles (C0…C7, axes.labelcolor for secondary text) and the preset decides the look.
// Marks: hairline solid grid, recessive baseline, round-capped 1.6 pt lines, markers with a ring
// in the surface colour, a surface-coloured gap between touching patches, no tick marks.
/** An rc object: matplotlib rc keys to plain values (pass it as `rc` or inside `style: [...]`). */
                                                                                                        

const modernBase = (t                                                                                                                     )         => ({
  'font.family': 'Inter', 'font.size': 9.5,
  'figure.figsize': [6.4, 4], 'figure.dpi': 200,
  'figure.subplot.left': 0.1, 'figure.subplot.right': 0.95, 'figure.subplot.bottom': 0.15, 'figure.subplot.top': 0.78,
  'figure.facecolor': t.surface, 'axes.facecolor': t.surface, 'savefig.facecolor': t.surface,
  'text.color': t.ink,
  'axes.titlesize': 13, 'axes.titleweight': 'semibold', 'axes.titlelocation': 'left', 'axes.titlepad': 24, 'axes.titlecolor': t.ink,
  'axes.labelsize': 9, 'axes.labelcolor': t.ink2, 'axes.labelpad': 8,
  'axes.edgecolor': t.base, 'axes.linewidth': 0.8,
  'axes.spines.top': false, 'axes.spines.right': false, 'axes.spines.left': false,
  'axes.grid': true, 'axes.grid.axis': 'y', 'axes.axisbelow': true,
  'grid.color': t.grid, 'grid.linewidth': 0.6, 'grid.linestyle': '-',
  'xtick.major.size': 0, 'ytick.major.size': 0, 'xtick.major.pad': 7, 'ytick.major.pad': 7,
  'xtick.color': t.base, 'ytick.color': t.base, 'xtick.labelcolor': t.muted, 'ytick.labelcolor': t.muted,
  'xtick.labelsize': 8.5, 'ytick.labelsize': 8.5,
  'axes.prop_cycle': t.cycle,
  'lines.linewidth': 1.6, 'lines.solid_capstyle': 'round', 'lines.solid_joinstyle': 'round',
  'lines.markersize': 6, 'lines.markeredgewidth': 1.5, 'lines.markeredgecolor': t.surface,
  'patch.force_edgecolor': true, 'patch.edgecolor': t.surface, 'patch.linewidth': 1.2,
  'legend.frameon': false, 'legend.fontsize': 8.5, 'legend.labelcolor': t.ink2, 'legend.handlelength': 1.4,
  'axes.xmargin': 0.02, 'axes.ymargin': 0.06,
});

/** Modern product chart on a light surface. */
export const modern         = modernBase({
  surface: '#FCFCFB', ink: '#0B0B0B', ink2: '#52514E', muted: '#898781', grid: '#E1E0D9', base: '#C3C2B7',
  cycle: ['#2A78D6', '#EB6834', '#1BAF7A', '#EDA100', '#E87BA4', '#008300', '#6250D6', '#E34948'],
});

/** The same chart on a dark surface: the palette's dark steps, not an inversion. */
export const modernDark         = modernBase({
  surface: '#1A1A19', ink: '#F0EFEC', ink2: '#C3C2B7', muted: '#898781', grid: '#2C2C2A', base: '#383835',
  cycle: ['#3987E5', '#D95926', '#199E70', '#C98500', '#D55181', '#008300', '#9085E9', '#E66767'],
});
